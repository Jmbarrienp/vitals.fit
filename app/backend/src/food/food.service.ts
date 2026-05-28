import { Injectable } from '@nestjs/common';
import { LocalFoodAdapter } from './adapters/local.adapter';

@Injectable()
export class FoodService {
  constructor(private adapter: LocalFoodAdapter) {}

  search(query: string, limit = 15) {
    return this.adapter.search(query, limit);
  }

  getCommon(limit = 20) {
    return this.adapter.getCommon(limit);
  }

  findById(id: string) {
    return this.adapter.findById(id);
  }
}
