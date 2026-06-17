-- Phase 2A.3: persist the structured recommendation reason code.
-- Additive, nullable, no default: metadata-only, online-safe (no table rewrite, no backfill).
ALTER TABLE "Recommendation" ADD COLUMN "reason" TEXT;
