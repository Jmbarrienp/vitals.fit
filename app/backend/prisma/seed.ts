import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

const foods = [
  // ── PROTEÍNAS ──
  { name: 'Pechuga de pollo', aliases: ['pollo a la plancha', 'pollo cocido'], cal: 165, p: 31, c: 0, f: 3.6, fi: 0, common: true },
  { name: 'Muslo de pollo', aliases: ['pollo muslo'], cal: 209, p: 26, c: 0, f: 11, fi: 0, common: true },
  { name: 'Carne molida de res', aliases: ['carne picada', 'carne molida'], cal: 250, p: 26, c: 0, f: 15, fi: 0, common: true },
  { name: 'Bistec de res', aliases: ['carne de res', 'filete'], cal: 271, p: 26, c: 0, f: 18, fi: 0, common: false },
  { name: 'Atún en agua', aliases: ['atun', 'atún enlatado'], cal: 116, p: 26, c: 0, f: 1, fi: 0, common: true },
  { name: 'Salmón', aliases: ['salmon'], cal: 208, p: 20, c: 0, f: 13, fi: 0, common: true },
  { name: 'Tilapia', aliases: ['mojarra'], cal: 96, p: 21, c: 0, f: 1.7, fi: 0, common: true },
  { name: 'Camarón', aliases: ['camaron', 'gambas'], cal: 99, p: 24, c: 0.2, f: 0.3, fi: 0, common: false },
  { name: 'Huevo entero', aliases: ['huevo'], cal: 155, p: 13, c: 1.1, f: 11, fi: 0, common: true },
  { name: 'Clara de huevo', aliases: ['claras'], cal: 52, p: 11, c: 0.7, f: 0.2, fi: 0, common: true },
  { name: 'Frijoles negros cocidos', aliases: ['frijoles', 'caraotas', 'porotos negros'], cal: 132, p: 8.9, c: 24, f: 0.5, fi: 8.7, common: true },
  { name: 'Lenteja cocida', aliases: ['lentejas'], cal: 116, p: 9, c: 20, f: 0.4, fi: 7.9, common: true },
  { name: 'Garbanzo cocido', aliases: ['garbanzos', 'chickpeas'], cal: 164, p: 8.9, c: 27, f: 2.6, fi: 7.6, common: false },
  { name: 'Carne de cerdo', aliases: ['puerco', 'chancho'], cal: 242, p: 27, c: 0, f: 14, fi: 0, common: false },
  { name: 'Pavo molido', aliases: ['pavo'], cal: 170, p: 22, c: 0, f: 9, fi: 0, common: false },
  { name: 'Proteína en polvo (whey)', aliases: ['proteina whey', 'suplemento proteico'], cal: 400, p: 75, c: 10, f: 5, fi: 0, common: true },
  { name: 'Queso cottage', aliases: ['cottage'], cal: 98, p: 11, c: 3.4, f: 4.3, fi: 0, common: true },

  // ── CARBOHIDRATOS ──
  { name: 'Arroz blanco cocido', aliases: ['arroz'], cal: 130, p: 2.7, c: 28, f: 0.3, fi: 0.4, common: true },
  { name: 'Arroz integral cocido', aliases: ['arroz integral'], cal: 112, p: 2.6, c: 23, f: 0.9, fi: 1.8, common: true },
  { name: 'Avena en hojuelas', aliases: ['avena', 'oatmeal'], cal: 389, p: 17, c: 66, f: 7, fi: 10, common: true },
  { name: 'Tortilla de maíz', aliases: ['tortilla', 'taco'], cal: 218, p: 5.7, c: 46, f: 3, fi: 5.2, common: true },
  { name: 'Pan blanco', aliases: ['pan de caja', 'pan blanco de molde'], cal: 265, p: 9, c: 49, f: 3.2, fi: 2.7, common: true },
  { name: 'Pan integral', aliases: ['pan de trigo'], cal: 247, p: 13, c: 41, f: 4.2, fi: 6, common: false },
  { name: 'Papa blanca cocida', aliases: ['papa', 'patata cocida'], cal: 87, p: 1.9, c: 20, f: 0.1, fi: 1.8, common: true },
  { name: 'Camote cocido', aliases: ['camote', 'batata', 'boniato'], cal: 86, p: 1.6, c: 20, f: 0.1, fi: 3, common: false },
  { name: 'Pasta cocida', aliases: ['espagueti', 'macarron', 'fideos'], cal: 158, p: 5.8, c: 31, f: 0.9, fi: 1.8, common: true },
  { name: 'Quinoa cocida', aliases: ['quinua'], cal: 120, p: 4.4, c: 21, f: 1.9, fi: 2.8, common: false },
  { name: 'Plátano maduro', aliases: ['platano', 'banana'], cal: 89, p: 1.1, c: 23, f: 0.3, fi: 2.6, common: true },
  { name: 'Arepa de maíz', aliases: ['arepa'], cal: 234, p: 5, c: 49, f: 1.5, fi: 2.2, common: true },
  { name: 'Maíz dulce cocido', aliases: ['elote', 'choclo', 'mazorca'], cal: 96, p: 3.4, c: 21, f: 1.5, fi: 2.4, common: false },

  // ── VEGETALES ──
  { name: 'Brócoli', aliases: ['brocoli'], cal: 34, p: 2.8, c: 7, f: 0.4, fi: 2.6, common: true },
  { name: 'Espinaca', aliases: ['espinacas'], cal: 23, p: 2.9, c: 3.6, f: 0.4, fi: 2.2, common: true },
  { name: 'Lechuga', aliases: ['lechuga romana', 'ensalada'], cal: 15, p: 1.4, c: 2.9, f: 0.2, fi: 1.3, common: true },
  { name: 'Tomate', aliases: ['jitomate', 'tomate rojo'], cal: 18, p: 0.9, c: 3.9, f: 0.2, fi: 1.2, common: true },
  { name: 'Zanahoria', aliases: ['zanahorias'], cal: 41, p: 0.9, c: 10, f: 0.2, fi: 2.8, common: true },
  { name: 'Aguacate', aliases: ['palta', 'avocado'], cal: 160, p: 2, c: 9, f: 15, fi: 6.7, common: true },
  { name: 'Cebolla', aliases: ['cebolla blanca', 'cebolla morada'], cal: 40, p: 1.1, c: 9.3, f: 0.1, fi: 1.7, common: false },
  { name: 'Pepino', aliases: ['pepino cohombro'], cal: 15, p: 0.7, c: 3.6, f: 0.1, fi: 0.5, common: false },
  { name: 'Pimiento', aliases: ['chile dulce', 'aji', 'pimentón'], cal: 31, p: 1, c: 6, f: 0.3, fi: 2.1, common: false },
  { name: 'Calabacín', aliases: ['zucchini', 'calabacita'], cal: 17, p: 1.2, c: 3.1, f: 0.3, fi: 1, common: false },

  // ── FRUTAS ──
  { name: 'Manzana', aliases: ['manzana roja', 'manzana verde'], cal: 52, p: 0.3, c: 14, f: 0.2, fi: 2.4, common: true },
  { name: 'Naranja', aliases: ['mandarina'], cal: 47, p: 0.9, c: 12, f: 0.1, fi: 2.4, common: true },
  { name: 'Mango', aliases: ['manga'], cal: 60, p: 0.8, c: 15, f: 0.4, fi: 1.6, common: true },
  { name: 'Fresa', aliases: ['frutilla', 'fresas'], cal: 32, p: 0.7, c: 7.7, f: 0.3, fi: 2, common: false },
  { name: 'Piña', aliases: ['ananás', 'ananá'], cal: 50, p: 0.5, c: 13, f: 0.1, fi: 1.4, common: false },
  { name: 'Papaya', aliases: ['lechosa', 'fruta bomba'], cal: 43, p: 0.5, c: 11, f: 0.3, fi: 1.7, common: false },
  { name: 'Sandía', aliases: ['patilla'], cal: 30, p: 0.6, c: 7.6, f: 0.2, fi: 0.4, common: false },

  // ── LÁCTEOS ──
  { name: 'Leche entera', aliases: ['leche'], cal: 61, p: 3.2, c: 4.8, f: 3.3, fi: 0, common: true },
  { name: 'Leche descremada', aliases: ['leche light', 'leche desnatada'], cal: 35, p: 3.4, c: 5, f: 0.1, fi: 0, common: false },
  { name: 'Yogur natural', aliases: ['yogurt', 'yogur'], cal: 59, p: 3.5, c: 4.7, f: 3.3, fi: 0, common: true },
  { name: 'Yogur griego', aliases: ['yogur griego sin azucar'], cal: 97, p: 9, c: 6, f: 5, fi: 0, common: true },
  { name: 'Queso fresco', aliases: ['queso blanco', 'queso panela'], cal: 98, p: 7, c: 2, f: 7, fi: 0, common: false },

  // ── GRASAS Y SEMILLAS ──
  { name: 'Aceite de oliva', aliases: ['aceite'], cal: 884, p: 0, c: 0, f: 100, fi: 0, common: false },
  { name: 'Mantequilla', aliases: ['manteca'], cal: 717, p: 0.9, c: 0.1, f: 81, fi: 0, common: false },
  { name: 'Almendras', aliases: ['almendra'], cal: 579, p: 21, c: 22, f: 50, fi: 12.5, common: true },
  { name: 'Nueces', aliases: ['nuez'], cal: 654, p: 15, c: 14, f: 65, fi: 6.7, common: false },
  { name: 'Maní', aliases: ['cacahuate', 'mani'], cal: 567, p: 26, c: 16, f: 49, fi: 8.5, common: true },
  { name: 'Semillas de chía', aliases: ['chia'], cal: 486, p: 17, c: 42, f: 31, fi: 34, common: false },

  // ── COMIDAS PREPARADAS COMUNES ──
  { name: 'Tamale de pollo', aliases: ['tamal'], cal: 160, p: 9, c: 25, f: 3.5, fi: 2, common: false },
  { name: 'Empanada de carne', aliases: ['empanada'], cal: 290, p: 14, c: 35, f: 10, fi: 1.5, common: true },
  { name: 'Ceviche de camarón', aliases: ['ceviche'], cal: 85, p: 15, c: 5, f: 1, fi: 0.5, common: false },
  { name: 'Tortilla de maíz con frijoles', aliases: ['taco de frijoles'], cal: 180, p: 7, c: 35, f: 2.5, fi: 5, common: false },
];

async function main() {
  console.log('Seeding food database...');
  let created = 0;

  for (const food of foods) {
    const existing = await prisma.foodItem.findFirst({
      where: { nameLower: food.name.toLowerCase() },
    });

    if (!existing) {
      await prisma.foodItem.create({
        data: {
          name: food.name,
          nameLower: food.name.toLowerCase(),
          nameAliases: food.aliases,
          caloriesPer100g: food.cal,
          proteinPer100g: food.p,
          carbsPer100g: food.c,
          fatPer100g: food.f,
          fiberPer100g: food.fi,
          source: 'curated_latam',
          isVerified: true,
          isCommon: food.common,
        },
      });
      created++;
    }
  }

  console.log(`✅ Seeded ${created} new foods (${foods.length - created} already existed)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
