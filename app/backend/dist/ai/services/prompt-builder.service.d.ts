import { UserSnapshot } from '../../recommendations/types/user-snapshot';
export declare class PromptBuilderService {
    private static readonly SYSTEM_PROMPT;
    getSystemPrompt(): string;
    buildUserPrompt(snap: UserSnapshot): string;
}
