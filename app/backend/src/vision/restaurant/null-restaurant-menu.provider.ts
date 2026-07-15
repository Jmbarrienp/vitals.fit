import { Injectable } from '@nestjs/common';
import { MenuLookupResult } from '../types/restaurant-contract';
import { MenuLookupRequest, RestaurantMenuProvider } from './restaurant-menu.port';

/**
 * The default menu provider (V3.4): always not-found. This is a deliberate
 * null object, not a stub — production runs with it until a real menu source
 * exists, and the platform's behavior with it is a fully supported state:
 * restaurant context still surfaces (name, category, confidence), the proposal
 * simply carries no menu candidates. Deterministic, zero-cost, zero-network.
 */
@Injectable()
export class NullRestaurantMenuProvider implements RestaurantMenuProvider {
  readonly id = 'none';

  async lookup(_req: MenuLookupRequest): Promise<MenuLookupResult> {
    return { found: false, restaurantName: null, items: [] };
  }
}
