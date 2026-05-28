import { PrismaService } from '../../prisma/prisma.service';
import { FoodAdapter, NormalizedFood } from './food-adapter.interface';
export declare class LocalFoodAdapter implements FoodAdapter {
    private prisma;
    constructor(prisma: PrismaService);
    search(query: string, limit: number): Promise<NormalizedFood[]>;
    getCommon(limit: number): Promise<NormalizedFood[]>;
    findById(id: string): Promise<NormalizedFood | null>;
    private normalize;
}
