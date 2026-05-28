import { RegisterTokenDto } from '../dto/register-token.dto';
import { DeviceTokenService } from '../services/device-token.service';
export declare class PushController {
    private readonly deviceToken;
    constructor(deviceToken: DeviceTokenService);
    registerToken(req: {
        user: {
            id: string;
        };
    }, dto: RegisterTokenDto): Promise<{
        ok: boolean;
    }>;
}
