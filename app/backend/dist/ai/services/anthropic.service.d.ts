import { ConfigService } from '@nestjs/config';
import { AiRequest, AiResponse } from '../types/ai.types';
export declare class AnthropicService {
    private readonly config;
    private readonly client;
    readonly model: string;
    private readonly logger;
    readonly hasKey: boolean;
    constructor(config: ConfigService);
    complete(req: AiRequest): Promise<AiResponse>;
    private callApi;
}
