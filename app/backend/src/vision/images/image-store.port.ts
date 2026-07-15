/**
 * Image transport seam (Phase 2D.2 V2).
 *
 * The `VisionProvider` port carries an OPAQUE `imageRef` — never bytes. A real
 * recognition backend needs the actual pixels, so the adapter resolves the ref
 * through this store instead. That indirection is precisely what let V2 add a
 * real vendor WITHOUT touching `VisionProvider`: turning a reference into bytes
 * is infrastructure, not part of the recognition contract.
 *
 * It is also the seam durable object storage plugs into later — a
 * `SupabaseImageStore` (or S3, or GCS) implementing this port is a one-line swap
 * in `VisionModule`, exactly like a provider. No consumer learns about it.
 *
 * Invariant carried over from V0 and enforced here: raw bytes NEVER reach the
 * database. `VisionScan.imageRef` only ever stores the ref string `put()` returns.
 */

/** The image formats the platform accepts. Deliberately narrow — a vendor that supports fewer is the adapter's problem, not the contract's. */
export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const SUPPORTED_MIMES: SupportedImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Payload ceiling. Mobile already captures compressed (`quality: 0.6`), which
 * lands well under this; the cap is the backstop that keeps a hostile or broken
 * client from pushing a huge body through the request path.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB decoded
/** base64 inflates ~4/3; this bounds the STRING before we spend memory decoding it. */
export const MAX_IMAGE_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;

export interface StoredImage {
  base64: string;
  mimeType: SupportedImageMime;
  bytes: number;
}

export interface VisionImageStore {
  readonly id: string;
  /** Persists bytes and returns the opaque ref that identifies them. The ref — not the bytes — is what the scan row stores. */
  put(base64: string, mimeType: string): Promise<string>;
  /** Bytes for a ref, or null when the ref is unknown/expired/not ours (e.g. a fixture keyword ref). Never throws on a miss. */
  resolve(imageRef: string): Promise<StoredImage | null>;
  /** Releases the bytes. Safe to call with a ref this store doesn't own. */
  discard(imageRef: string): Promise<void>;
}

/** Injection token — `VisionImageStore` is an interface, so Nest needs a symbol to bind the adapter to. */
export const VISION_IMAGE_STORE = Symbol('VISION_IMAGE_STORE');

export function isSupportedImageMime(mime: string): mime is SupportedImageMime {
  return (SUPPORTED_MIMES as string[]).includes(mime);
}

/** Decoded byte length of a base64 payload, without allocating the buffer. */
export function base64Bytes(base64: string): number {
  return Buffer.byteLength(base64, 'base64');
}
