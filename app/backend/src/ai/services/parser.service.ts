import { Injectable } from '@nestjs/common';

@Injectable()
export class ParserService {
  clean(raw: string): string {
    let text = raw.trim().replace(/^["']|["']$/g, '');
    text = text.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');

    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
    return sentences.slice(0, 3).join(' ').trim() || text;
  }
}
