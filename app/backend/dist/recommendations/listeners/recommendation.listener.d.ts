import { PrismaService } from '../../prisma/prisma.service';
import { ExpoPushService } from '../../push/services/expo-push.service';
import { RecommendationService } from '../services/recommendation.service';
import { MealLoggedEvent } from '../../orchestrator/events/meal.event';
export declare class RecommendationListener {
    private readonly recommendation;
    private readonly prisma;
    private readonly expoPush;
    private readonly logger;
    constructor(recommendation: RecommendationService, prisma: PrismaService, expoPush: ExpoPushService);
    handleMealLogged(event: MealLoggedEvent): Promise<void>;
}
