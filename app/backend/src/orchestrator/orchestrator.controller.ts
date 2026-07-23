import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrchestratorService } from './orchestrator.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiAuthErrors } from '../common/swagger/error-responses';

@ApiTags('orchestrator')
@ApiBearerAuth()
@ApiAuthErrors()
@UseGuards(JwtAuthGuard)
@Controller('orchestrator')
export class OrchestratorController {
  constructor(private orchestratorService: OrchestratorService) {}

  /** Platform-wide subsystem status (not user-scoped). */
  @ApiOperation({ summary: 'Orchestrator subsystem status.' })
  @Get('status')
  getStatus() {
    return this.orchestratorService.getStatus();
  }
}
