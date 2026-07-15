-- Nutrition Vision V3.3 — Intelligent Portion Estimation.
-- Single additive, nullable column: which PortionMethod produced the proposed
-- grams a user then accepted or edited. Without it the correction engine cannot
-- tell a model error from a catalog-default mismatch. Existing rows stay null
-- and are excluded from bias learning by construction. No backfill, no lock risk.
ALTER TABLE "VisionFeedback" ADD COLUMN "proposedMethod" TEXT;
