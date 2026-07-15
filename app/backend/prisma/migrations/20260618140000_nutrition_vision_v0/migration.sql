-- Nutrition Vision V0 (Phase 2D.2): additive skeleton only. New tables +
-- provenance columns on LoggedMeal. No existing column altered. ASCII-only
-- (embedded-postgres smoke uses WIN1252 on Windows).

ALTER TABLE "LoggedMeal" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "LoggedMeal" ADD COLUMN "visionScanId" TEXT;

CREATE TABLE "VisionScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imageRef" TEXT NOT NULL,
    "providerId" TEXT,
    "providerModel" TEXT,
    "providerVersion" TEXT,
    "detections" JSONB,
    "proposal" JSONB,
    "scanConfidence" DOUBLE PRECISION,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisionScan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisionFeedback" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "detectionIndex" INTEGER NOT NULL,
    "proposedFoodItemId" TEXT,
    "confirmedFoodItemId" TEXT,
    "proposedGrams" DOUBLE PRECISION,
    "confirmedGrams" DOUBLE PRECISION,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoggedMeal_visionScanId_key" ON "LoggedMeal"("visionScanId");

CREATE INDEX "VisionScan_userId_createdAt_idx" ON "VisionScan"("userId", "createdAt");
CREATE INDEX "VisionScan_status_expiresAt_idx" ON "VisionScan"("status", "expiresAt");

CREATE INDEX "VisionFeedback_scanId_idx" ON "VisionFeedback"("scanId");
CREATE INDEX "VisionFeedback_userId_createdAt_idx" ON "VisionFeedback"("userId", "createdAt");

ALTER TABLE "VisionScan" ADD CONSTRAINT "VisionScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisionFeedback" ADD CONSTRAINT "VisionFeedback_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "VisionScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoggedMeal" ADD CONSTRAINT "LoggedMeal_visionScanId_fkey" FOREIGN KEY ("visionScanId") REFERENCES "VisionScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
