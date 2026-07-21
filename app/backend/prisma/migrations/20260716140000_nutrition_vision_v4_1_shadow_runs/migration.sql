-- Nutrition Vision V4.1 — Live Provider Governance.
--
-- Append-only evidence from challenger providers run in SHADOW against real
-- scans. This is what makes a PAIRED comparison possible: V3.5 could only
-- score each provider on its own traffic (confounding provider quality with
-- traffic mix); with a shadow run linked to the same scanId, both providers
-- are judged on the SAME input against the SAME user confirmation.
--
-- The unique (scanId, providerId) makes ingestion idempotent: one verdict per
-- provider per scan, so a retry can never inflate the evidence. Rows are
-- written once and never updated. No existing table is modified.
CREATE TABLE "VisionShadowRun" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerModel" TEXT,
    "providerVersion" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "detections" JSONB,
    "latencyMs" DOUBLE PRECISION,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisionShadowRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisionShadowRun_scanId_providerId_key" ON "VisionShadowRun"("scanId", "providerId");
CREATE INDEX "VisionShadowRun_providerId_createdAt_idx" ON "VisionShadowRun"("providerId", "createdAt");
CREATE INDEX "VisionShadowRun_createdAt_idx" ON "VisionShadowRun"("createdAt");

ALTER TABLE "VisionShadowRun" ADD CONSTRAINT "VisionShadowRun_scanId_fkey"
    FOREIGN KEY ("scanId") REFERENCES "VisionScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
