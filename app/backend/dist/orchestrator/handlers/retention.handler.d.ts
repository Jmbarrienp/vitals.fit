import { PrismaService } from '../../prisma/prisma.service';
import { MealLoggedEvent } from '../events/meal.event';
import { OnboardingCompletedEvent } from '../events/onboarding.event';
export declare class RetentionHandler {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    handleMealLogged(event: MealLoggedEvent): Promise<void>;
    handleOnboarding(event: OnboardingCompletedEvent): Promise<void>;
    private checkMilestones;
}
