"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationsModule = void 0;
const common_1 = require("@nestjs/common");
const ai_module_1 = require("../ai/ai.module");
const push_module_1 = require("../push/push.module");
const recommendations_service_1 = require("./recommendations.service");
const recommendations_controller_1 = require("./recommendations.controller");
const recommendation_service_1 = require("./services/recommendation.service");
const context_builder_service_1 = require("./services/context-builder.service");
const recommendation_listener_1 = require("./listeners/recommendation.listener");
let RecommendationsModule = class RecommendationsModule {
};
exports.RecommendationsModule = RecommendationsModule;
exports.RecommendationsModule = RecommendationsModule = __decorate([
    (0, common_1.Module)({
        imports: [ai_module_1.AiModule, push_module_1.PushModule],
        providers: [
            recommendations_service_1.RecommendationsService,
            recommendation_service_1.RecommendationService,
            context_builder_service_1.ContextBuilderService,
            recommendation_listener_1.RecommendationListener,
        ],
        controllers: [recommendations_controller_1.RecommendationsController],
        exports: [recommendations_service_1.RecommendationsService],
    })
], RecommendationsModule);
//# sourceMappingURL=recommendations.module.js.map