export declare class WeightUpdatedEvent {
    readonly userId: string;
    readonly weightKg: number;
    readonly date: Date;
    constructor(userId: string, weightKg: number, date: Date);
}
