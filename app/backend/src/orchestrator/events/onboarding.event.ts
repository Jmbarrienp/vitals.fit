export class OnboardingCompletedEvent {
  constructor(
    public readonly userId: string,
    public readonly goalType: string,
  ) {}
}
