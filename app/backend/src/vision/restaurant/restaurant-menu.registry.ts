import { ConfigService } from '@nestjs/config';
import { RestaurantMenuProvider } from './restaurant-menu.port';

/**
 * Selects the active RestaurantMenuProvider by config
 * (`RESTAURANT_MENU_PROVIDER`) — the same pattern as the Vision, Barcode and
 * OCR registries.
 *
 * Default is 'none' (a lookup that always answers not-found) — a third default
 * philosophy, argued like the other two: Vision/OCR default to 'fixture'
 * because a real call costs money; Barcode defaults to its real provider
 * because OpenFoodFacts is free and keyless; menus have NO free keyless source
 * today, and a fixture answering canned menus in production would be worse
 * than answering nothing. Restaurant context works fine without a menu source
 * — the proposal just carries no menu candidates.
 */
export class RestaurantMenuProviderRegistry {
  private readonly providers: Map<string, RestaurantMenuProvider>;
  private readonly activeId: string;

  constructor(config: ConfigService, providers: RestaurantMenuProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.activeId = config.get<string>('RESTAURANT_MENU_PROVIDER', 'none');
  }

  /** The configured provider. Throws if it isn't registered (fails loud at startup, not silently). */
  active(): RestaurantMenuProvider {
    const provider = this.providers.get(this.activeId);
    if (!provider) {
      throw new Error(`Unknown RESTAURANT_MENU_PROVIDER "${this.activeId}" — no provider registered under that id`);
    }
    return provider;
  }

  get(id: string): RestaurantMenuProvider | undefined {
    return this.providers.get(id);
  }

  list(): RestaurantMenuProvider[] {
    return [...this.providers.values()];
  }
}
