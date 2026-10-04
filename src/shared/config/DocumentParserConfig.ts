import { ConfigurationError } from "../errors/DocumentParserErrors.js";

/** Approximate per-block prompt overhead (labels) counted against chunk size. */
export const CHUNK_BLOCK_OVERHEAD_CHARS = 48;
/** Smallest allowed maxChunkChars so a chunk can always hold at least one labelled piece. */
export const MIN_ALLOWED_CHUNK_CHARS = 200;

export interface DocumentLimits {
  /** Hard cap on raw input size. Protects extractors from oversized files. */
  readonly maxDocumentBytes: number;
  /** Hard cap on LLM calls for extraction. Exceeding it fails loudly instead of truncating. */
  readonly maxChunks: number;
  /** Target upper bound of characters per chunk (including per-block overhead). */
  readonly maxChunkChars: number;
  /** A chunk is closed at a section boundary once it holds at least this many characters. */
  readonly minChunkChars: number;
}

export interface LLMProcessingConfig {
  /** How many times an invalid response is sent back for repair. 0 disables repair. */
  readonly maxRepairAttempts: number;
  /** Retries for retryable provider/transport failures (429, 5xx, timeouts). */
  readonly maxTransportRetries: number;
  /** Base delay for exponential backoff between transport retries. */
  readonly retryBaseDelayMs: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  /** Parallel chunk extraction calls. Keep at 1 for a single local model. */
  readonly chunkConcurrency: number;
  /** Characters of opening text included in the classification digest. */
  readonly classificationDigestChars: number;
  /** Upper bound on one extracted entity value. */
  readonly maxEntityValueChars: number;
}

export interface DocumentParserConfig {
  readonly limits: DocumentLimits;
  readonly llm: LLMProcessingConfig;
}

export interface DocumentParserConfigOverrides {
  readonly limits?: Partial<DocumentLimits>;
  readonly llm?: Partial<LLMProcessingConfig>;
}

export const DEFAULT_DOCUMENT_PARSER_CONFIG: DocumentParserConfig = {
  limits: {
    maxDocumentBytes: 20 * 1024 * 1024,
    maxChunks: 64,
    maxChunkChars: 6000,
    minChunkChars: 2000,
  },
  llm: {
    maxRepairAttempts: 2,
    maxTransportRetries: 2,
    retryBaseDelayMs: 500,
    temperature: 0,
    maxOutputTokens: 4096,
    chunkConcurrency: 1,
    classificationDigestChars: 3000,
    maxEntityValueChars: 1000,
  },
};

function requireInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new ConfigurationError(`${name} must be an integer >= ${min} (received ${String(value)})`);
  }
}

/** Merges overrides over defaults and validates the result. Fails fast on bad configuration. */
export function resolveDocumentParserConfig(
  overrides: DocumentParserConfigOverrides = {},
): DocumentParserConfig {
  const config: DocumentParserConfig = {
    limits: { ...DEFAULT_DOCUMENT_PARSER_CONFIG.limits, ...overrides.limits },
    llm: { ...DEFAULT_DOCUMENT_PARSER_CONFIG.llm, ...overrides.llm },
  };

  const { limits, llm } = config;
  requireInteger("limits.maxDocumentBytes", limits.maxDocumentBytes, 1);
  requireInteger("limits.maxChunks", limits.maxChunks, 1);
  requireInteger("limits.maxChunkChars", limits.maxChunkChars, MIN_ALLOWED_CHUNK_CHARS);
  requireInteger("limits.minChunkChars", limits.minChunkChars, 0);
  if (limits.minChunkChars >= limits.maxChunkChars) {
    throw new ConfigurationError("limits.minChunkChars must be smaller than limits.maxChunkChars");
  }
  requireInteger("llm.maxRepairAttempts", llm.maxRepairAttempts, 0);
  requireInteger("llm.maxTransportRetries", llm.maxTransportRetries, 0);
  requireInteger("llm.retryBaseDelayMs", llm.retryBaseDelayMs, 0);
  requireInteger("llm.maxOutputTokens", llm.maxOutputTokens, 1);
  requireInteger("llm.chunkConcurrency", llm.chunkConcurrency, 1);
  requireInteger("llm.classificationDigestChars", llm.classificationDigestChars, 100);
  requireInteger("llm.maxEntityValueChars", llm.maxEntityValueChars, 1);
  if (!Number.isFinite(llm.temperature) || llm.temperature < 0 || llm.temperature > 2) {
    throw new ConfigurationError("llm.temperature must be between 0 and 2");
  }
  return config;
}
