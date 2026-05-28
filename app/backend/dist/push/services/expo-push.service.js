"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ExpoPushService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpoPushService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const device_token_service_1 = require("./device-token.service");
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
let ExpoPushService = ExpoPushService_1 = class ExpoPushService {
    constructor(deviceToken, prisma) {
        this.deviceToken = deviceToken;
        this.prisma = prisma;
        this.logger = new common_1.Logger(ExpoPushService_1.name);
    }
    sendToUser(userId, title, body, trigger) {
        this.doSend(userId, title, body, trigger).catch((err) => this.logger.error(`Unhandled push error userId=${userId}`, err));
    }
    async doSend(userId, title, body, trigger) {
        const tokens = await this.deviceToken.getActiveForUser(userId);
        if (tokens.length === 0) {
            this.logger.debug(`No active push tokens for userId=${userId}`);
            return;
        }
        const messages = tokens.map((to) => ({
            to,
            title,
            body,
            data: { trigger },
            sound: 'default',
        }));
        const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(messages),
        });
        const json = (await res.json());
        await Promise.all(json.data.map(async (ticket, i) => {
            const token = tokens[i];
            const isDeviceGone = ticket.details?.error === 'DeviceNotRegistered';
            const status = ticket.status === 'ok' ? 'sent' : (ticket.details?.error ?? 'failed');
            if (isDeviceGone) {
                await this.deviceToken.markInactive(token);
            }
            await this.prisma.pushLog.create({
                data: {
                    userId,
                    token,
                    title,
                    body: body.slice(0, 200),
                    trigger,
                    status,
                    receiptId: ticket.id,
                    errorCode: ticket.message,
                },
            });
            if (ticket.status === 'ok') {
                this.logger.log(`Push sent userId=${userId} trigger=${trigger} receipt=${ticket.id}`);
            }
            else {
                this.logger.warn(`Push failed userId=${userId} error=${ticket.details?.error} token=${token.slice(-6)}`);
            }
        }));
    }
};
exports.ExpoPushService = ExpoPushService;
exports.ExpoPushService = ExpoPushService = ExpoPushService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [device_token_service_1.DeviceTokenService,
        prisma_service_1.PrismaService])
], ExpoPushService);
//# sourceMappingURL=expo-push.service.js.map