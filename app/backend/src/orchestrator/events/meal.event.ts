export class MealLoggedEvent {
  constructor(
    public readonly userId: string,
    public readonly mealId: string,
    public readonly loggedAt: Date,
    public readonly totalCalories: number,
  ) {}
}
