import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BarcodeProductData, FoodAdapter, NormalizedFood } from './food-adapter.interface';

// A food must be logged at least this many times to count as "frequent"
// (otherwise a single log would duplicate it into both Recents and Frequents).
const MIN_FREQUENT_COUNT = 3;

/** Accent-stripped, lowercased form for accent/typo-insensitive matching. */
export function normalizeFood(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Classic Levenshtein distance (small strings — cheap). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Score one normalized candidate string against the normalized query. 0 = no match. */
function scoreString(candidate: string, q: string): number {
  if (!candidate) return 0;
  if (candidate === q) return 100;
  if (candidate.startsWith(q)) return 85;
  if (candidate.split(' ').some((t) => t.startsWith(q))) return 72;
  if (candidate.includes(q)) return 55;
  // Typo tolerance only for reasonably long queries — avoids matching everything.
  if (q.length >= 4) {
    const tokens = candidate.split(' ');
    const best = Math.min(levenshtein(candidate, q), ...tokens.map((t) => levenshtein(t, q)));
    if (best === 1) return 42;
    if (best === 2) return 28;
  }
  return 0;
}

@Injectable()
export class LocalFoodAdapter implements FoodAdapter {
  constructor(private prisma: PrismaService) {}

  /** Foods visible to a user: global catalog + that user's own custom foods. */
  private eligibilityWhere(userId?: string) {
    return userId ? { OR: [{ createdByUserId: null }, { createdByUserId: userId }] } : { createdByUserId: null };
  }

  async search(query: string, limit: number, userId?: string): Promise<NormalizedFood[]> {
    const q = normalizeFood(query);
    if (!q) return [];

    const eligible = this.eligibilityWhere(userId);
    const tokens = Array.from(new Set([q, ...q.split(' ').filter(Boolean)]));

    // Structural candidates across the whole catalog (substring + exact alias)…
    const structural = await this.prisma.foodItem.findMany({
      where: {
        AND: [
          eligible,
          {
            OR: [
              { nameNormalized: { contains: q } },
              { nameLower: { contains: q } },
              { nameAliases: { hasSome: tokens } },
            ],
          },
        ],
      },
      take: 80,
    });

    // …plus the common pool, so typo-fuzzy matching has something to rank against.
    const commonPool = await this.prisma.foodItem.findMany({
      where: { AND: [eligible, { isCommon: true }] },
      take: 150,
    });

    const byId = new Map<string, (typeof structural)[number]>();
    for (const f of [...structural, ...commonPool]) byId.set(f.id, f);

    const favIds = userId ? await this.favoriteIdSet(userId) : new Set<string>();

    return Array.from(byId.values())
      .map((f) => {
        const name = normalizeFood(f.name);
        const aliasScores = (f.nameAliases ?? []).map((a) => scoreString(normalizeFood(a), q) - 5);
        let score = Math.max(scoreString(name, q), 0, ...aliasScores);
        if (score <= 0) return { f, score: 0 };
        if (f.isCommon) score += 12;
        if (favIds.has(f.id)) score += 25;
        return { f, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name))
      .slice(0, limit)
      .map((x) => this.normalize(x.f, favIds.has(x.f.id)));
  }

  async getCommon(limit: number, userId?: string): Promise<NormalizedFood[]> {
    const items = await this.prisma.foodItem.findMany({
      where: { isCommon: true, createdByUserId: null },
      orderBy: { name: 'asc' },
      take: limit,
    });
    const favIds = userId ? await this.favoriteIdSet(userId) : new Set<string>();
    return items.map((i) => this.normalize(i, favIds.has(i.id)));
  }

  async findById(id: string): Promise<NormalizedFood | null> {
    const item = await this.prisma.foodItem.findUnique({ where: { id } });
    return item ? this.normalize(item) : null;
  }

  /** Exact barcode identity, scoped to the global catalog + this user's own custom foods (never another user's private foods). */
  async findByBarcode(barcode: string, userId?: string): Promise<NormalizedFood | null> {
    const item = await this.prisma.foodItem.findFirst({
      where: { barcode, ...this.eligibilityWhere(userId) },
    });
    if (!item) return null;
    const favIds = userId ? await this.favoriteIdSet(userId) : new Set<string>();
    return this.normalize(item, favIds.has(item.id));
  }

  /**
   * Creates a GLOBAL catalog row (createdByUserId: null) for a barcode-resolved
   * product — public, factual, commercially available data, not a private user
   * food, so future scans by ANY user hit it. Re-checks by barcode first: two
   * scans of a never-before-seen barcode in quick succession should resolve to
   * ONE row, not two. This narrows but does not eliminate a race under truly
   * concurrent requests — acceptable at this project's traffic scale, and no
   * DB-level unique constraint was added on the pre-existing `barcode` column
   * to avoid risking a migration failure against any already-seeded data.
   */
  async upsertFromBarcode(barcode: string, product: BarcodeProductData): Promise<NormalizedFood> {
    const existing = await this.prisma.foodItem.findFirst({ where: { barcode, createdByUserId: null } });
    if (existing) return this.normalize(existing);

    const displayName = product.brand ? `${product.name} (${product.brand})` : product.name;
    const item = await this.prisma.foodItem.create({
      data: {
        name: displayName,
        nameLower: displayName.toLowerCase(),
        nameNormalized: normalizeFood(displayName),
        nameAliases: [],
        caloriesPer100g: product.caloriesPer100g,
        proteinPer100g: product.proteinPer100g,
        carbsPer100g: product.carbsPer100g,
        fatPer100g: product.fatPer100g,
        fiberPer100g: product.fiberPer100g,
        source: 'open_food_facts',
        barcode,
        isVerified: false,
        isCommon: false,
      },
    });
    return this.normalize(item);
  }

  /** Distinct foods this user logged most recently (newest first). */
  async getRecent(userId: string, limit = 20): Promise<NormalizedFood[]> {
    const rows = await this.prisma.loggedMealItem.findMany({
      where: { foodItemId: { not: null }, loggedMeal: { dailyLog: { userId } } },
      orderBy: { loggedMeal: { loggedAt: 'desc' } },
      include: { foodItem: true },
      take: 200,
    });
    const favIds = await this.favoriteIdSet(userId);
    const seen = new Set<string>();
    const out: NormalizedFood[] = [];
    for (const r of rows) {
      if (!r.foodItem || seen.has(r.foodItem.id)) continue;
      seen.add(r.foodItem.id);
      out.push(this.normalize(r.foodItem, favIds.has(r.foodItem.id)));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Foods this user logs most often in the last 60 days. */
  async getFrequent(userId: string, limit = 20): Promise<NormalizedFood[]> {
    const since = new Date();
    since.setDate(since.getDate() - 60);

    const grouped = await this.prisma.loggedMealItem.groupBy({
      by: ['foodItemId'],
      where: {
        foodItemId: { not: null },
        loggedMeal: { dailyLog: { userId }, loggedAt: { gte: since } },
      },
      _count: { foodItemId: true },
      having: { foodItemId: { _count: { gte: MIN_FREQUENT_COUNT } } },
      orderBy: { _count: { foodItemId: 'desc' } },
      take: limit,
    });

    const ids = grouped.map((g) => g.foodItemId).filter((x): x is string => !!x);
    if (ids.length === 0) return [];

    const foods = await this.prisma.foodItem.findMany({ where: { id: { in: ids } } });
    const byId = new Map(foods.map((f) => [f.id, f]));
    const favIds = await this.favoriteIdSet(userId);

    return ids
      .map((id) => byId.get(id))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => this.normalize(f, favIds.has(f.id)));
  }

  /** Private custom foods this user created (deterministic order; may be unlogged). */
  async getCustom(userId: string): Promise<NormalizedFood[]> {
    const items = await this.prisma.foodItem.findMany({
      where: { createdByUserId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const favIds = await this.favoriteIdSet(userId);
    return items.map((i) => this.normalize(i, favIds.has(i.id)));
  }

  async getFavorites(userId: string): Promise<NormalizedFood[]> {
    const favs = await this.prisma.foodFavorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { foodItem: true },
    });
    return favs.map((f) => this.normalize(f.foodItem, true));
  }

  async addFavorite(userId: string, foodItemId: string): Promise<void> {
    await this.prisma.foodFavorite.upsert({
      where: { userId_foodItemId: { userId, foodItemId } },
      create: { userId, foodItemId },
      update: {},
    });
  }

  async removeFavorite(userId: string, foodItemId: string): Promise<void> {
    await this.prisma.foodFavorite.deleteMany({ where: { userId, foodItemId } });
  }

  /** Creates a private custom food owned by the user (server normalizes name fields). */
  async createCustom(
    userId: string,
    data: {
      name: string;
      caloriesPer100g: number;
      proteinPer100g: number;
      carbsPer100g: number;
      fatPer100g: number;
      fiberPer100g?: number;
    },
  ): Promise<NormalizedFood> {
    const item = await this.prisma.foodItem.create({
      data: {
        name: data.name.trim(),
        nameLower: data.name.trim().toLowerCase(),
        nameNormalized: normalizeFood(data.name),
        nameAliases: [],
        caloriesPer100g: data.caloriesPer100g,
        proteinPer100g: data.proteinPer100g,
        carbsPer100g: data.carbsPer100g,
        fatPer100g: data.fatPer100g,
        fiberPer100g: data.fiberPer100g ?? 0,
        source: 'custom',
        createdByUserId: userId,
        isVerified: false,
        isCommon: false,
      },
    });
    return this.normalize(item, false);
  }

  private async favoriteIdSet(userId: string): Promise<Set<string>> {
    const favs = await this.prisma.foodFavorite.findMany({
      where: { userId },
      select: { foodItemId: true },
    });
    return new Set(favs.map((f) => f.foodItemId));
  }

  private normalize(item: any, isFavorite = false): NormalizedFood {
    return {
      id: item.id,
      name: item.name,
      caloriesPer100g: item.caloriesPer100g,
      proteinPer100g: item.proteinPer100g,
      carbsPer100g: item.carbsPer100g,
      fatPer100g: item.fatPer100g,
      fiberPer100g: item.fiberPer100g,
      source: item.source,
      isCommon: item.isCommon,
      isFavorite,
    };
  }
}
