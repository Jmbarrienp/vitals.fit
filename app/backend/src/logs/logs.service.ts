import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LogMealDto, LogMealItemDto, MealType } from './dto/log-meal.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MealDeletedEvent, MealLoggedEvent } from '../orchestrator/events/meal.event';

/** Forma resuelta de un ítem, lista para persistir. Macros calculados en backend. */
interface ResolvedItem {
  foodItemId: string | null;
  servingSizeId: string | null;
  nameSnapshot: string;
  quantity: number;
  unit: string;
  amountG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class LogsService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async logMeal(userId: string, dto: LogMealDto) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get or create today's daily log
    let dailyLog = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (!dailyLog) {
      dailyLog = await this.prisma.dailyLog.create({ data: { userId, date: today } });
    }

    // Resolve items (server-calculated) or fall back to legacy payload (compat).
    const items = await this.resolveItems(dto);

    const mealType = (dto.mealType ?? this.inferMealType(new Date())) as MealType;
    const totals = items.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calories,
        protein: acc.protein + i.proteinG,
        carbs: acc.carbs + i.carbsG,
        fat: acc.fat + i.fatG,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const dailyLogId = dailyLog.id;
    const meal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.loggedMeal.create({
        data: {
          dailyLogId,
          mealType: mealType as any,
          name: dto.name ?? mealType,
          totalCalories: totals.calories,
          totalProteinG: round1(totals.protein),
          totalCarbsG: round1(totals.carbs),
          totalFatG: round1(totals.fat),
          items: {
            create: items.map((i) => ({
              foodItemId: i.foodItemId,
              servingSizeId: i.servingSizeId,
              nameSnapshot: i.nameSnapshot,
              quantity: i.quantity,
              unit: i.unit,
              amountG: i.amountG,
              calories: i.calories,
              proteinG: i.proteinG,
              carbsG: i.carbsG,
              fatG: i.fatG,
            })),
          },
        },
      });
      await this.recalcDailyLog(tx, dailyLogId);
      return created;
    });

    // Emit event → recommendation listener (AI + push) and retention handler (sin cambios)
    this.eventEmitter.emit(
      'meal.logged',
      new MealLoggedEvent(userId, meal.id, new Date(), totals.calories),
    );

    return this.getToday(userId);
  }

  /** Edita una comida: reemplaza sus ítems (si se envían) y/o actualiza mealType/name. */
  async updateMeal(userId: string, mealId: string, dto: LogMealDto) {
    const meal = await this.getOwnedMeal(userId, mealId);

    const replaceItems = (dto.items && dto.items.length > 0) || dto.totalCalories != null;
    const items = replaceItems ? await this.resolveItems(dto) : null;

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.LoggedMealUpdateInput = {};
      if (dto.mealType) data.mealType = dto.mealType as any;
      if (dto.name !== undefined) data.name = dto.name;

      if (items) {
        const t = this.sumItems(items);
        data.totalCalories = t.calories;
        data.totalProteinG = round1(t.protein);
        data.totalCarbsG = round1(t.carbs);
        data.totalFatG = round1(t.fat);
        await tx.loggedMealItem.deleteMany({ where: { loggedMealId: mealId } });
        data.items = {
          create: items.map((i) => ({
            foodItemId: i.foodItemId,
            servingSizeId: i.servingSizeId,
            nameSnapshot: i.nameSnapshot,
            quantity: i.quantity,
            unit: i.unit,
            amountG: i.amountG,
            calories: i.calories,
            proteinG: i.proteinG,
            carbsG: i.carbsG,
            fatG: i.fatG,
          })),
        };
      }

      await tx.loggedMeal.update({ where: { id: mealId }, data });
      await this.recalcDailyLog(tx, meal.dailyLogId);
    });

    return this.getToday(userId);
  }

  /** Borra una comida completa (cascade borra sus ítems) y recalcula el día. */
  async deleteMeal(userId: string, mealId: string) {
    const meal = await this.getOwnedMeal(userId, mealId);
    await this.prisma.$transaction(async (tx) => {
      await tx.loggedMeal.delete({ where: { id: mealId } });
      await this.recalcDailyLog(tx, meal.dailyLogId);
    });
    // Counterpart of meal.logged (V3.6) — without it, derived state keeps the
    // calories of a meal that no longer exists until its TTL expires.
    this.eventEmitter.emit('meal.deleted', new MealDeletedEvent(userId, mealId, new Date()));
    return this.getToday(userId);
  }

  /** Borra un ítem; si la comida queda vacía, se borra. Recalcula totales de comida y día. */
  async deleteMealItem(userId: string, mealId: string, itemId: string) {
    const meal = await this.getOwnedMeal(userId, mealId);
    const item = meal.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Ítem no encontrado.');
    const mealDisappears = meal.items.length === 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.loggedMealItem.delete({ where: { id: itemId } });
      const remaining = meal.items.filter((i) => i.id !== itemId);

      if (remaining.length === 0) {
        await tx.loggedMeal.delete({ where: { id: mealId } });
      } else {
        const totals = remaining.reduce(
          (acc, i) => ({
            calories: acc.calories + i.calories,
            protein: acc.protein + Number(i.proteinG),
            carbs: acc.carbs + Number(i.carbsG),
            fat: acc.fat + Number(i.fatG),
          }),
          { calories: 0, protein: 0, carbs: 0, fat: 0 },
        );
        await tx.loggedMeal.update({
          where: { id: mealId },
          data: {
            totalCalories: totals.calories,
            totalProteinG: round1(totals.protein),
            totalCarbsG: round1(totals.carbs),
            totalFatG: round1(totals.fat),
          },
        });
      }
      await this.recalcDailyLog(tx, meal.dailyLogId);
    });

    // Removing the last item deletes the meal — same event as an explicit delete.
    if (mealDisappears) {
      this.eventEmitter.emit('meal.deleted', new MealDeletedEvent(userId, mealId, new Date()));
    }
    return this.getToday(userId);
  }

  /** Carga una comida verificando que pertenezca al usuario (vía dailyLog). */
  private async getOwnedMeal(userId: string, mealId: string) {
    const meal = await this.prisma.loggedMeal.findUnique({
      where: { id: mealId },
      include: { dailyLog: true, items: true },
    });
    if (!meal || meal.dailyLog.userId !== userId) {
      throw new NotFoundException('Comida no encontrada.');
    }
    return meal;
  }

  private sumItems(items: ResolvedItem[]) {
    return items.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calories,
        protein: acc.protein + i.proteinG,
        carbs: acc.carbs + i.carbsG,
        fat: acc.fat + i.fatG,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }

  /**
   * Convierte el payload (nuevo o viejo) en ítems resueltos con macros calculados en backend.
   * - Nuevo: dto.items[] → resolver cada uno contra FoodItem/ServingSize.
   * - Compat: dto.totalCalories presente → un único ítem manual con los totales del cliente.
   */
  private async resolveItems(dto: LogMealDto): Promise<ResolvedItem[]> {
    if (dto.items && dto.items.length > 0) {
      return Promise.all(dto.items.map((it) => this.resolveItem(it)));
    }

    if (dto.totalCalories != null) {
      return [
        {
          foodItemId: null,
          servingSizeId: null,
          nameSnapshot: dto.name ?? 'Comida',
          quantity: 1,
          unit: 'serving',
          amountG: 0,
          calories: Math.round(dto.totalCalories),
          proteinG: round1(dto.totalProteinG ?? 0),
          carbsG: round1(dto.totalCarbsG ?? 0),
          fatG: round1(dto.totalFatG ?? 0),
        },
      ];
    }

    throw new BadRequestException('Debes enviar items[] o los totales de la comida.');
  }

  private async resolveItem(it: LogMealItemDto): Promise<ResolvedItem> {
    // Ítem manual (one-off): se confían los macros provistos, sin FoodItem.
    if (it.customName) {
      return {
        foodItemId: null,
        servingSizeId: null,
        nameSnapshot: it.customName,
        quantity: it.quantity ?? 1,
        unit: it.unit ?? 'serving',
        amountG: 0,
        calories: Math.round(it.calories ?? 0),
        proteinG: round1(it.proteinG ?? 0),
        carbsG: round1(it.carbsG ?? 0),
        fatG: round1(it.fatG ?? 0),
      };
    }

    if (!it.foodItemId) {
      throw new BadRequestException('Cada ítem requiere foodItemId o customName.');
    }

    const food = await this.prisma.foodItem.findUnique({ where: { id: it.foodItemId } });
    if (!food) {
      throw new BadRequestException(`Alimento ${it.foodItemId} no encontrado.`);
    }

    let grams: number;
    let unit = it.unit ?? 'g';

    if (it.servingSizeId) {
      const ss = await this.prisma.servingSize.findFirst({
        where: { id: it.servingSizeId, foodItemId: food.id },
      });
      if (!ss) {
        throw new BadRequestException('La porción no corresponde a este alimento.');
      }
      grams = it.quantity * ss.grams;
      unit = 'serving';
    } else {
      // "g" o "ml" se tratan como gramos (densidad ~1 para líquidos comunes).
      grams = it.quantity;
    }

    const ratio = grams / 100;
    return {
      foodItemId: food.id,
      servingSizeId: it.servingSizeId ?? null,
      nameSnapshot: food.name,
      quantity: it.quantity,
      unit,
      amountG: grams,
      calories: Math.round(food.caloriesPer100g * ratio),
      proteinG: round1(food.proteinPer100g * ratio),
      carbsG: round1(food.carbsPer100g * ratio),
      fatG: round1(food.fatPer100g * ratio),
    };
  }

  /**
   * Única fuente de verdad de los totales diarios: suma los totales de cada comida.
   * Reutilizable por create/edit/delete (recibe el tx para correr dentro de la transacción).
   */
  private async recalcDailyLog(tx: Prisma.TransactionClient, dailyLogId: string) {
    const meals = await tx.loggedMeal.findMany({ where: { dailyLogId } });
    const totals = meals.reduce(
      (acc, m) => ({
        calories: acc.calories + m.totalCalories,
        protein: acc.protein + Number(m.totalProteinG),
        carbs: acc.carbs + Number(m.totalCarbsG),
        fat: acc.fat + Number(m.totalFatG),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    await tx.dailyLog.update({
      where: { id: dailyLogId },
      data: {
        caloriesLogged: totals.calories,
        proteinG: round1(totals.protein),
        carbsG: round1(totals.carbs),
        fatG: round1(totals.fat),
      },
    });
  }

  /** Infiere el tipo de comida por la hora local si el cliente no lo envía. */
  private inferMealType(date: Date): MealType {
    const h = date.getHours();
    if (h < 11) return MealType.BREAKFAST;
    if (h < 16) return MealType.LUNCH;
    if (h < 21) return MealType.DINNER;
    return MealType.SNACK;
  }

  async getToday(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyLog = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
      include: { loggedMeals: { include: { items: true } } },
    });

    if (!dailyLog) {
      return { message: 'No hay registros para hoy', date: today, meals: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    }

    // Compare to goal targets
    const goal = await this.prisma.goal.findFirst({
      where: { userId, isActive: true },
    });

    const remaining = goal ? {
      calories: goal.targetCalories - dailyLog.caloriesLogged,
      proteinG: goal.proteinG - Number(dailyLog.proteinG),
      carbsG: goal.carbsG - Number(dailyLog.carbsG),
      fatG: goal.fatG - Number(dailyLog.fatG),
    } : null;

    return {
      date: today,
      totals: {
        calories: dailyLog.caloriesLogged,
        proteinG: dailyLog.proteinG,
        carbsG: dailyLog.carbsG,
        fatG: dailyLog.fatG,
      },
      target: goal ? {
        calories: goal.targetCalories,
        proteinG: goal.proteinG,
        carbsG: goal.carbsG,
        fatG: goal.fatG,
      } : null,
      remaining,
      meals: dailyLog.loggedMeals,
    };
  }

  async getRecent(userId: string) {
    const logs = await this.prisma.dailyLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 7,
      include: { loggedMeals: true },
    });
    return logs;
  }
}
