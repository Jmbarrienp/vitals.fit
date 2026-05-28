"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestratorModule = void 0;
const common_1 = require("@nestjs/common");
const orchestrator_service_1 = require("./orchestrator.service");
const orchestrator_controller_1 = require("./orchestrator.controller");
const progress_handler_1 = require("./handlers/progress.handler");
const recommendation_handler_1 = require("./handlers/recommendation.handler");
const retention_handler_1 = require("./handlers/retention.handler");
let OrchestratorModule = class OrchestratorModule {
};
exports.OrchestratorModule = OrchestratorModule;
exports.OrchestratorModule = OrchestratorModule = __decorate([
    (0, common_1.Module)({
        providers: [orchestrator_service_1.OrchestratorService, progress_handler_1.ProgressHandler, recommendation_handler_1.RecommendationHandler, retention_handler_1.RetentionHandler],
        controllers: [orchestrator_controller_1.OrchestratorController],
        exports: [orchestrator_service_1.OrchestratorService],
    })
], OrchestratorModule);
//# sourceMappingURL=orchestrator.module.js.map