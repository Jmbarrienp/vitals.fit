-- DropForeignKey
ALTER TABLE "LoggedMealItem" DROP CONSTRAINT "LoggedMealItem_foodItemId_fkey";

-- AlterTable
ALTER TABLE "LoggedMealItem" ADD COLUMN     "nameSnapshot" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "servingSizeId" TEXT,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'g',
ALTER COLUMN "foodItemId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ServingSize" (
    "id" TEXT NOT NULL,
    "foodItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServingSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServingSize_foodItemId_idx" ON "ServingSize"("foodItemId");

-- CreateIndex
CREATE INDEX "LoggedMealItem_loggedMealId_idx" ON "LoggedMealItem"("loggedMealId");

-- CreateIndex
CREATE INDEX "LoggedMealItem_foodItemId_idx" ON "LoggedMealItem"("foodItemId");

-- AddForeignKey
ALTER TABLE "ServingSize" ADD CONSTRAINT "ServingSize_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedMealItem" ADD CONSTRAINT "LoggedMealItem_foodItemId_fkey" FOREIGN KEY ("foodItemId") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedMealItem" ADD CONSTRAINT "LoggedMealItem_servingSizeId_fkey" FOREIGN KEY ("servingSizeId") REFERENCES "ServingSize"("id") ON DELETE SET NULL ON UPDATE CASCADE;

