export interface AiRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface AiResponse {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}
