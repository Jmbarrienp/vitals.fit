import { Controller, Get, UseGuards } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('orchestrator')
export class OrchestratorController {
  constructor(private orchestratorService: OrchestratorService) {}

  @Get('status')
  getStatus() {
    return this.orchestratorService.getStatus();
  }
}
