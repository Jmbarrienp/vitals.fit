import { ConfigService } from '@nestjs/config';
import { BarcodeLookupProvider } from './barcode-lookup.port';

/**
 * Selects the active BarcodeLookupProvider by config (`BARCODE_LOOKUP_PROVIDER`)
 * — the same pattern as `VisionProviderRegistry` / `CLAUDE_MODEL`. Registered
 * providers come in as an array (wired by the module factory); adding USDA, a
 * commercial API, or an offline cache is a one-line change to that array.
 *
 * Default is 'openfoodfacts', not 'fixture' — unlike Vision, a real barcode
 * lookup costs nothing and needs no key (OpenFoodFacts is a free public API),
 * so there is no reason to protect production from it the way Claude is gated
 * behind an unset key. Tests and smokes pass 'fixture' explicitly.
 */
export class BarcodeLookupProviderRegistry {
  private readonly providers: Map<string, BarcodeLookupProvider>;
  private readonly activeId: string;

  constructor(config: ConfigService, providers: BarcodeLookupProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.activeId = config.get<string>('BARCODE_LOOKUP_PROVIDER', 'openfoodfacts');
  }

  active(): BarcodeLookupProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      throw new Error(`Unknown BARCODE_LOOKUP_PROVIDER "${this.activeId}" — no provider registered under that id`);
    }
    return provider;
  }

  get(id: string): BarcodeLookupProvider | undefined {
    return this.providers.get(id);
  }

  list(): BarcodeLookupProvider[] {
    return [...this.providers.values()];
  }
}
