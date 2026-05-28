"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const anthropic_service_1 = require("./services/anthropic.service");
const prompt_builder_service_1 = require("./services/prompt-builder.service");
const parser_service_1 = require("./services/parser.service");
const telemetry_service_1 = require("./services/telemetry.service");
let AiModule = class AiModule {
};
exports.AiModule = AiModule;
exports.AiModule = AiModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule],
        providers: [anthropic_service_1.AnthropicService, prompt_builder_service_1.PromptBuilderService, parser_service_1.ParserService, telemetry_service_1.TelemetryService],
        exports: [anthropic_service_1.AnthropicService, prompt_builder_service_1.PromptBuilderService, parser_service_1.ParserService, telemetry_service_1.TelemetryService],
    })
], AiModule);
//# sourceMappingURL=ai.module.js.map