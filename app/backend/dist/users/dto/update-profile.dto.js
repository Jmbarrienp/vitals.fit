"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateProfileDto = exports.Equipment = exports.FitnessLevel = exports.ActivityLevel = exports.Sex = void 0;
const class_validator_1 = require("class-validator");
var Sex;
(function (Sex) {
    Sex["MALE"] = "MALE";
    Sex["FEMALE"] = "FEMALE";
    Sex["OTHER"] = "OTHER";
})(Sex || (exports.Sex = Sex = {}));
var ActivityLevel;
(function (ActivityLevel) {
    ActivityLevel["SEDENTARY"] = "SEDENTARY";
    ActivityLevel["LIGHT"] = "LIGHT";
    ActivityLevel["MODERATE"] = "MODERATE";
    ActivityLevel["ACTIVE"] = "ACTIVE";
    ActivityLevel["EXTRA"] = "EXTRA";
})(ActivityLevel || (exports.ActivityLevel = ActivityLevel = {}));
var FitnessLevel;
(function (FitnessLevel) {
    FitnessLevel["BEGINNER"] = "BEGINNER";
    FitnessLevel["INTERMEDIATE"] = "INTERMEDIATE";
    FitnessLevel["ADVANCED"] = "ADVANCED";
})(FitnessLevel || (exports.FitnessLevel = FitnessLevel = {}));
var Equipment;
(function (Equipment) {
    Equipment["GYM"] = "GYM";
    Equipment["HOME"] = "HOME";
    Equipment["NONE"] = "NONE";
})(Equipment || (exports.Equipment = Equipment = {}));
class UpdateProfileDto {
}
exports.UpdateProfileDto = UpdateProfileDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(13),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], UpdateProfileDto.prototype, "age", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(30),
    (0, class_validator_1.Max)(300),
    __metadata("design:type", Number)
], UpdateProfileDto.prototype, "weightKg", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(100),
    (0, class_validator_1.Max)(250),
    __metadata("design:type", Number)
], UpdateProfileDto.prototype, "heightCm", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(Sex),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "sex", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(ActivityLevel),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "activityLevel", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(FitnessLevel),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "fitnessLevel", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(Equipment),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "equipment", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], UpdateProfileDto.prototype, "dietaryRestrictions", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], UpdateProfileDto.prototype, "allergies", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], UpdateProfileDto.prototype, "medicalConditions", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(7),
    __metadata("design:type", Number)
], UpdateProfileDto.prototype, "daysAvailablePerWeek", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(20),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], UpdateProfileDto.prototype, "sessionDurationMin", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], UpdateProfileDto.prototype, "country", void 0);
//# sourceMappingURL=update-profile.dto.js.map