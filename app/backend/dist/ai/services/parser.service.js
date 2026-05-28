"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserService = void 0;
const common_1 = require("@nestjs/common");
let ParserService = class ParserService {
    clean(raw) {
        let text = raw.trim().replace(/^["']|["']$/g, '');
        text = text.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
        const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
        return sentences.slice(0, 3).join(' ').trim() || text;
    }
};
exports.ParserService = ParserService;
exports.ParserService = ParserService = __decorate([
    (0, common_1.Injectable)()
], ParserService);
//# sourceMappingURL=parser.service.js.map