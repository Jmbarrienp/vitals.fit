import { ConfigService } from '@nestjs/config';
import { VisionProvider } from './vision-provider.port';

/**
 * Selects the active VisionProvider by config (`VISION_PROVIDER`), exactly like
 * `CLAUDE_MODEL` works for the coach. Deterministic: given the same registered
 * providers and the same config, `active()` always returns the same adapter.
 *
 * Registered providers come in as an array (wired by the module factory), so a
 * real vendor adapter is added with a ONE-LINE change to that array — no pipeline
 * or registry change. This is the seam that makes providers swappable.
 */
export class VisionProviderRegistry {
  private readonly providers: Map<string, VisionProvider>;
  private readonly activeId: string;

  constructor(config: ConfigService, providers: VisionProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.activeId = config.get<string>('VISION_PROVIDER', 'fixture');
  }

  /** The configured provider. Throws if it isn't registered (fails loud at startup, not silently). */
  active(): VisionProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      throw new Error(`Unknown VISION_PROVIDER "${this.activeId}" — no provider registered under that id`);
    }
    return provider;
  }

  get(id: string): VisionProvider | undefined {
    return this.providers.get(id);
  }

  list(): VisionProvider[] {
    return [...this.providers.values()];
  }
}
