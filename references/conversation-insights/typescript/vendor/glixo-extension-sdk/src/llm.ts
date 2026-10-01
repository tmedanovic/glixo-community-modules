export interface ToolCallDetails {
  readonly id: string;
  readonly name: string;
  readonly argumentsFragment?: string;
  readonly complete: boolean;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export type FinishReason = "stop" | "length" | "tool" | "cancelled" | "content-filter" | "error" | { readonly unknown: string };
export type ContentPart = { readonly text: string } | { readonly reasoning: string } | { readonly toolCallDetails: ToolCallDetails };

export interface ProviderEvent {
  readonly requestId: string;
  readonly part?: ContentPart;
  readonly usage?: Usage;
  readonly finish?: FinishReason;
  readonly providerRequestId?: string;
  readonly providerResponseId?: string;
}
