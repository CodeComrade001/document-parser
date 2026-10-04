/**
 * LLM abstraction. The core parser depends ONLY on this port.
 * Implementations live in src/adapters/llm/* (local, google, future).
 */
export interface LLMRequest {
  /** Trusted instructions. Never contains document content. */
  readonly system: string;
  /** Task prompt; untrusted document content is delimited inside it. */
  readonly prompt: string;
  /** The parser only consumes JSON. Providers should use native JSON mode if they have one. */
  readonly responseFormat: "json";
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Observability only. Providers must not alter behaviour based on it. */
  readonly metadata?: {
    readonly operation: string;
    readonly promptVersion: string;
  };
}

export interface LLMUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface LLMResponse {
  /** Raw model output. Untrusted until schema-validated. */
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly usage?: LLMUsage;
}

export interface LLMProvider {
  /**
   * MUST throw LLMProviderError on failure, setting `retryable` correctly.
   * MUST NOT retry internally; retry policy is owned by StructuredGenerator.
   */
  generate(request: LLMRequest): Promise<LLMResponse>;
}
