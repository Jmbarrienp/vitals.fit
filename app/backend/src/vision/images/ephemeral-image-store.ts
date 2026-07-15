import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MAX_IMAGE_BYTES,
  StoredImage,
  SupportedImageMime,
  VisionImageStore,
  base64Bytes,
  isSupportedImageMime,
} from './image-store.port';

const REF_SCHEME = 'vision-mem://';
const TTL_MS = 5 * 60 * 1000; // far longer than a scan needs; bounds a leak if discard() is ever missed
const MAX_ENTRIES = 32; // Render Free is memory-poor — refuse to grow without bound

interface Entry {
  image: StoredImage;
  expiresAt: number;
}

/**
 * The default `VisionImageStore` (Phase 2D.2 V2): bytes live in-process only for
 * the moment recognition needs them, then are dropped.
 *
 * Why this is the honest V2 default rather than a placeholder for "real" storage:
 * recognition runs SYNCHRONOUSLY inside `createScan`, so the only consumer of the
 * pixels is the provider call happening a few lines later. Once the scan reaches
 * PROPOSED, nothing downstream reads the image again — candidates, portions,
 * confidence and the eventual LoggedMeal are all derived data. Persisting the
 * bytes past that point would buy an audit corpus we have no consumer for yet,
 * at the cost of infrastructure (bucket, credentials, lifecycle, RLS) this slice
 * doesn't need.
 *
 * What it deliberately does NOT do: survive a restart, or serve a re-read of an
 * old scan's image. When either becomes a requirement (a Vision eval corpus is
 * the obvious first one), a `SupabaseImageStore` implements the same port and
 * swaps in at the module — no provider, pipeline or contract change. That is the
 * whole point of the seam.
 *
 * Bounded on both axes (TTL + entry cap) so a missed `discard()` degrades into
 * eviction rather than a leak.
 */
@Injectable()
export class EphemeralImageStore implements VisionImageStore {
  readonly id = 'ephemeral';
  private readonly entries = new Map<string, Entry>();

  async put(base64: string, mimeType: string): Promise<string> {
    if (!isSupportedImageMime(mimeType)) {
      throw new BadRequestException(`Unsupported image type "${mimeType}".`);
    }
    const bytes = base64Bytes(base64);
    if (bytes === 0) throw new BadRequestException('Image payload is empty.');
    if (bytes > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Image is ${bytes} bytes; the limit is ${MAX_IMAGE_BYTES}.`);
    }

    this.sweep();
    if (this.entries.size >= MAX_ENTRIES) this.evictOldest();

    const ref = `${REF_SCHEME}${randomUUID()}`;
    this.entries.set(ref, {
      image: { base64, mimeType: mimeType as SupportedImageMime, bytes },
      expiresAt: Date.now() + TTL_MS,
    });
    return ref;
  }

  /**
   * Returns null — never throws — for a ref this store doesn't own. That matters:
   * fixture/eval refs are plain keywords like `eval-chicken-plate.jpg`, and the
   * fixture provider never calls resolve() at all. A real provider getting null
   * raises its own unresolved-image error, which the service degrades to manual.
   */
  async resolve(imageRef: string): Promise<StoredImage | null> {
    if (!imageRef.startsWith(REF_SCHEME)) return null;
    const entry = this.entries.get(imageRef);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(imageRef);
      return null;
    }
    return entry.image;
  }

  async discard(imageRef: string): Promise<void> {
    this.entries.delete(imageRef);
  }

  /** Test/diagnostic surface — how many payloads are currently held. */
  size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ref, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(ref);
    }
  }

  private evictOldest(): void {
    const oldest = this.entries.keys().next();
    if (!oldest.done) this.entries.delete(oldest.value);
  }
}
