import { OrchestratorService } from './orchestrator.service';
export declare class OrchestratorController {
    private orchestratorService;
    constructor(orchestratorService: OrchestratorService);
    getStatus(): {
        status: string;
        events: string[];
        handlers: string[];
    };
}
