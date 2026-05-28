export declare enum GoalType {
    LOSE_FAT = "LOSE_FAT",
    GAIN_MUSCLE = "GAIN_MUSCLE",
    MAINTAIN = "MAINTAIN",
    RECOMPOSITION = "RECOMPOSITION",
    HEALTH_WELLNESS = "HEALTH_WELLNESS"
}
export declare class CreateGoalDto {
    type: GoalType;
    targetWeightKg?: number;
}
