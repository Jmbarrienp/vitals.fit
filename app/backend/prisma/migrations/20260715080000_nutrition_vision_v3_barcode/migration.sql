-- Nutrition Vision V3.1 (Phase 2D.2): barcode is another VisionScan source, not
-- a new nutrition system. FoodItem.barcode already existed (unused) before this
-- migration -- no change needed there. The only new surface is a single nullable
-- column recording what was scanned, exactly as imageRef does for photo scans.
-- Additive only; no existing column altered; ASCII-only (embedded-postgres
-- smoke uses WIN1252 on Windows).

ALTER TABLE "VisionScan" ADD COLUMN "barcodeValue" TEXT;
