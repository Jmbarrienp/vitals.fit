import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnthropicService } from './services/anthropic.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { ParserService } from './services/parser.service';
import { TelemetryService } from './services/telemetry.service';

@Module({
  imports: [ConfigModule],
  providers: [AnthropicService, PromptBuilderService, ParserService, TelemetryService],
  exports: [AnthropicService, PromptBuilderService, ParserService, TelemetryService],
})
export class AiModule {}
