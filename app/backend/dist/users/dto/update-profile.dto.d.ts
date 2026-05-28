export declare enum Sex {
    MALE = "MALE",
    FEMALE = "FEMALE",
    OTHER = "OTHER"
}
export declare enum ActivityLevel {
    SEDENTARY = "SEDENTARY",
    LIGHT = "LIGHT",
    MODERATE = "MODERATE",
    ACTIVE = "ACTIVE",
    EXTRA = "EXTRA"
}
export declare enum FitnessLevel {
    BEGINNER = "BEGINNER",
    INTERMEDIATE = "INTERMEDIATE",
    ADVANCED = "ADVANCED"
}
export declare enum Equipment {
    GYM = "GYM",
    HOME = "HOME",
    NONE = "NONE"
}
export declare class UpdateProfileDto {
    name: string;
    age: number;
    weightKg: number;
    heightCm: number;
    sex: Sex;
    activityLevel: ActivityLevel;
    fitnessLevel: FitnessLevel;
    equipment?: Equipment;
    dietaryRestrictions?: string[];
    allergies?: string[];
    medicalConditions?: string[];
    daysAvailablePerWeek?: number;
    sessionDurationMin?: number;
    timezone?: string;
    country?: string;
}
