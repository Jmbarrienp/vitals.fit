export class WeightUpdatedEvent {
  constructor(
    public readonly userId: string,
    public readonly weightKg: number,
    public readonly date: Date,
  ) {}
}
