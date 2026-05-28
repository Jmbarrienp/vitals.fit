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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoodController = void 0;
const common_1 = require("@nestjs/common");
const food_service_1 = require("./food.service");
const search_food_dto_1 = require("./dto/search-food.dto");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
let FoodController = class FoodController {
    constructor(foodService) {
        this.foodService = foodService;
    }
    search(dto) {
        return this.foodService.search(dto.q, dto.limit);
    }
    getCommon() {
        return this.foodService.getCommon(20);
    }
    findById(id) {
        return this.foodService.findById(id);
    }
};
exports.FoodController = FoodController;
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [search_food_dto_1.SearchFoodDto]),
    __metadata("design:returntype", void 0)
], FoodController.prototype, "search", null);
__decorate([
    (0, common_1.Get)('common'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], FoodController.prototype, "getCommon", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FoodController.prototype, "findById", null);
exports.FoodController = FoodController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('food'),
    __metadata("design:paramtypes", [food_service_1.FoodService])
], FoodController);
//# sourceMappingURL=food.controller.js.map