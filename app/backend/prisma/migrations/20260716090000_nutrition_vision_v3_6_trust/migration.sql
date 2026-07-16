-- Nutrition Vision V3.6 — Auto-Accept Graduation & Provider Promotion.
--
-- 1) An append-only audit of every runtime trust decision. An auto-accepted
--    meal must remain explainable forever, under the policy version that
--    actually produced it. Its own table (not a Json blob) because the admin
--    surface queries it: graduated foods, pending foods, trust statistics.
CREATE TABLE "VisionTrustDecision" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "trustLevel" TEXT NOT NULL,
    "trustScore" DOUBLE PRECISION NOT NULL,
    "calibratedConfidence" DOUBLE PRECISION,
    "reportedConfidence" DOUBLE PRECISION,
    "providerId" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "foodItemId" TEXT,
    "signals" TEXT[],
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisionTrustDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisionTrustDecision_userId_createdAt_idx" ON "VisionTrustDecision"("userId", "createdAt");
CREATE INDEX "VisionTrustDecision_userId_foodItemId_modality_idx" ON "VisionTrustDecision"("userId", "foodItemId", "modality");
CREATE INDEX "VisionTrustDecision_action_createdAt_idx" ON "VisionTrustDecision"("action", "createdAt");

ALTER TABLE "VisionTrustDecision" ADD CONSTRAINT "VisionTrustDecision_scanId_fkey"
    FOREIGN KEY ("scanId") REFERENCES "VisionScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) The runtime trust query is "what has THIS user done with THIS food?".
--    Additive index only — no data change, no lock risk at current scale.
CREATE INDEX "VisionFeedback_userId_confirmedFoodItemId_idx" ON "VisionFeedback"("userId", "confirmedFoodItemId");
