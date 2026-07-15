import { Injectable } from '@nestjs/common';
import { MenuCandidate, MenuLookupResult } from '../types/restaurant-contract';
import { MenuLookupRequest, RestaurantMenuProvider } from './restaurant-menu.port';

/**
 * Deterministic, zero-cost menu source (V3.4) — the same role the vision/OCR
 * fixtures play: it makes the whole restaurant flow buildable, testable and
 * demoable before any real menu source exists. Same request always yields the
 * same menu. Nutrition values below simulate PUBLISHED chain-menu data (the
 * only kind a real provider may transcribe); dishes without published macros
 * carry nulls — exactly what the contract demands.
 */
@Injectable()
export class FixtureRestaurantMenuProvider implements RestaurantMenuProvider {
  readonly id = 'fixture';

  private static readonly MENUS: Record<string, MenuCandidate[]> = {
    'la esquina criolla': [
      { name: 'Bandeja de pollo a la plancha', calories: 620, proteinG: 48, carbsG: 55, fatG: 21, servingGrams: 450 },
      { name: 'Churrasco con arroz', calories: 780, proteinG: 52, carbsG: 60, fatG: 34, servingGrams: 520 },
      // Published calories only — many menu boards list nothing else. Nulls stay null.
      { name: 'Sopa de la casa', calories: 310, proteinG: null, carbsG: null, fatG: null, servingGrams: null },
      // No published nutrition at all: a name-only hint. Never a loggable number.
      { name: 'Postre del día', calories: null, proteinG: null, carbsG: null, fatG: null, servingGrams: null },
    ],
  };

  async lookup(req: MenuLookupRequest): Promise<MenuLookupResult> {
    const key = (req.restaurantName ?? '').trim().toLowerCase();
    const items = FixtureRestaurantMenuProvider.MENUS[key];
    if (!items) return { found: false, restaurantName: null, items: [] };
    return { found: true, restaurantName: req.restaurantName, items };
  }
}
