-- Nutrition Vision V3.5 — Continuous Learning & Evaluation Engine.
-- Three additive, nullable telemetry columns: the platform was MEASURING
-- latency and token usage on every real scan and then discarding both.
-- Null = recorded before V3.5 (unmeasured), never zero. No backfill possible
-- (the data was never stored), no lock risk.
ALTER TABLE "VisionScan" ADD COLUMN "latencyMs" DOUBLE PRECISION;
ALTER TABLE "VisionScan" ADD COLUMN "tokensIn" INTEGER;
ALTER TABLE "VisionScan" ADD COLUMN "tokensOut" INTEGER;
