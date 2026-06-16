-- Nutrition Phase 1C — serious catalog, search, favorites, custom foods
-- 100% additive (expand-contract): safe to run against live production.

-- AlterTable: FoodItem gains a normalized search column + custom-food ownership
ALTER TABLE "FoodItem" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "nameNormalized" TEXT NOT NULL DEFAULT '';

-- CreateTable: per-user food favorites
CREATE TABLE "FoodFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FoodFavorite_userId_idx" ON "FoodFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodFavorite_userId_foodItemId_key" ON "FoodFavorite"("userId", "foodItemId");

-- CreateIndex
CREATE INDEX "FoodItem_nameNormalized_idx" ON "FoodItem"("nameNormalized");

-- CreateIndex
CREATE INDEX "FoodItem_createdByUserId_idx" ON "FoodItem"("createdByUserId");

-- AddForeignKey
ALTER TABLE "FoodFavorite" ADD CONSTRAINT "FoodFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FoodFavorite" ADD CONSTRAINT "FoodFavorite_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill nameNormalized for existing rows: strip common Spanish accents from nameLower.
-- Keeps the migration dependency-free (no unaccent extension required).
UPDATE "FoodItem"
SET "nameNormalized" = translate(lower("nameLower"), 'áéíóúüñ', 'aeiouun')
WHERE "nameNormalized" = '';
