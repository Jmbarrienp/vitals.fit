import { ConfigService } from '@nestjs/config';
import { OCRProvider } from './ocr-provider.port';

/**
 * Selects the active OCRProvider by config (`OCR_PROVIDER`) — the same pattern
 * as `VisionProviderRegistry` and `BarcodeLookupProviderRegistry`. Registered
 * providers come in as an array (wired by the module factory), so adding a GPT
 * or on-device adapter is a one-line change there and nowhere else.
 *
 * Default is 'fixture', matching Vision rather than Barcode: a real OCR call
 * costs money and needs a vendor key, so production stays inert until it is
 * explicitly configured. (Barcode defaults to its real provider because
 * OpenFoodFacts is free and keyless — there is nothing to protect.)
 */
export class OCRProviderRegistry {
  private readonly providers: Map<string, OCRProvider>;
  private readonly activeId: string;

  constructor(config: ConfigService, providers: OCRProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.activeId = config.get<string>('OCR_PROVIDER', 'fixture');
  }

  /** The configured provider. Throws if it isn't registered (fails loud at startup, not silently). */
  active(): OCRProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      throw new Error(`Unknown OCR_PROVIDER "${this.activeId}" — no provider registered under that id`);
    }
    return provider;
  }

  get(id: string): OCRProvider | undefined {
    return this.providers.get(id);
  }

  list(): OCRProvider[] {
    return [...this.providers.values()];
  }
}
