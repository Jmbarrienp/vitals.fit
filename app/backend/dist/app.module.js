"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const app_controller_1 = require("./app.controller");
const config_1 = require("@nestjs/config");
const event_emitter_1 = require("@nestjs/event-emitter");
const ai_module_1 = require("./ai/ai.module");
const push_module_1 = require("./push/push.module");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const goals_module_1 = require("./goals/goals.module");
const nutrition_module_1 = require("./nutrition/nutrition.module");
const logs_module_1 = require("./logs/logs.module");
const progress_module_1 = require("./progress/progress.module");
const recommendations_module_1 = require("./recommendations/recommendations.module");
const orchestrator_module_1 = require("./orchestrator/orchestrator.module");
const food_module_1 = require("./food/food.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        controllers: [app_controller_1.AppController],
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            event_emitter_1.EventEmitterModule.forRoot(),
            ai_module_1.AiModule,
            push_module_1.PushModule,
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            goals_module_1.GoalsModule,
            nutrition_module_1.NutritionModule,
            logs_module_1.LogsModule,
            progress_module_1.ProgressModule,
            recommendations_module_1.RecommendationsModule,
            orchestrator_module_1.OrchestratorModule,
            food_module_1.FoodModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map