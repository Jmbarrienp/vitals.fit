export class MealLoggedEvent {
  constructor(
    public readonly userId: string,
    public readonly mealId: string,
    public readonly loggedAt: Date,
    public readonly totalCalories: number,
  ) {}
}

/**
 * A meal stopped existing (V3.6). The counterpart `meal.logged` always had and
 * `deleteMeal` never emitted — which left every derived consumer (nutrition
 * state, and through it the ledger/coach/planner) holding calories from a meal
 * the user had already deleted, until the state TTL happened to expire. That
 * gap predates Vision entirely; it surfaced here because undo makes deletion a
 * first-class, frequent action instead of a rare correction.
 *
 * Emitted by LogsService — the single write path owns its events, so Vision
 * never has to reach into another domain to announce a deletion.
 */
export class MealDeletedEvent {
  constructor(
    public readonly userId: string,
    public readonly mealId: string,
    public readonly deletedAt: Date,
  ) {}
}
