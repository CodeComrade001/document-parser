/**
 * Error taxonomy for the Document Parser.
 *
 * Callers can branch on `code` (stable, machine-readable) instead of parsing
 * messages. `cause` always preserves the original error for diagnostics.
 *
 * Messages and `details` MUST NOT contain document content, API keys or other
 * sensitive data; they end up in logs.
 */
export type DocumentParserErrorCode =
  | "PAYLOAD_INVALID"
  | "PAYLOAD_TOO_LARGE"
  | "FORMAT_UNDETECTABLE"
  | "FORMAT_MISMATCH"
  | "FORMAT_UNSUPPORTED"
  | "EXTRACTION_FAILED"
  | "EMPTY_DOCUMENT"
  | "DOCUMENT_TOO_LARGE"
  | "LLM_PROVIDER_FAILED"
  | "LLM_OUTPUT_INVALID"
  | "RESULT_INVALID"
  | "CONFIGURATION_INVALID";

export interface DocumentParserErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class DocumentParserError extends Error {
  public readonly code: DocumentParserErrorCode;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: DocumentParserErrorCode,
    message: string,
    options: DocumentParserErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
  }
}

/** The caller supplied a bad payload (client-side problem, not retryable). */
export class PayloadValidationError extends DocumentParserError {
  public constructor(
    message: string,
    code: "PAYLOAD_INVALID" | "PAYLOAD_TOO_LARGE" = "PAYLOAD_INVALID",
    options: DocumentParserErrorOptions = {},
  ) {
    super(code, message, options);
  }
}

/** Format could not be determined, conflicts with declared metadata, or has no registered extractor. */
export class DocumentFormatError extends DocumentParserError {
  public constructor(
    code: "FORMAT_UNDETECTABLE" | "FORMAT_MISMATCH" | "FORMAT_UNSUPPORTED",
    message: string,
    options: DocumentParserErrorOptions = {},
  ) {
    super(code, message, options);
  }
}

/** A deterministic extractor failed or returned an invalid raw document. */
export class ExtractionError extends DocumentParserError {
  public constructor(message: string, options: DocumentParserErrorOptions = {}) {
    super("EXTRACTION_FAILED", message, options);
  }
}

/** The document is valid but yields no usable text, or exceeds processing limits. */
export class DocumentContentError extends DocumentParserError {
  public constructor(
    code: "EMPTY_DOCUMENT" | "DOCUMENT_TOO_LARGE",
    message: string,
    options: DocumentParserErrorOptions = {},
  ) {
    super(code, message, options);
  }
}

/** Transport / provider failure. `retryable` tells the caller whether a retry can help. */
export class LLMProviderError extends DocumentParserError {
  public readonly provider: string;
  public readonly retryable: boolean;

  public constructor(
    provider: string,
    message: string,
    retryable: boolean,
    options: DocumentParserErrorOptions = {},
  ) {
    super("LLM_PROVIDER_FAILED", message, options);
    this.provider = provider;
    this.retryable = retryable;
  }
}

/** The LLM never produced schema-valid output within the repair budget. */
export class LLMOutputValidationError extends DocumentParserError {
  public constructor(message: string, options: DocumentParserErrorOptions = {}) {
    super("LLM_OUTPUT_INVALID", message, options);
  }
}

/** The assembled final result violated the output contract (indicates a bug, not bad input). */
export class ResultContractError extends DocumentParserError {
  public constructor(message: string, options: DocumentParserErrorOptions = {}) {
    super("RESULT_INVALID", message, options);
  }
}

export class ConfigurationError extends DocumentParserError {
  public constructor(message: string, options: DocumentParserErrorOptions = {}) {
    super("CONFIGURATION_INVALID", message, options);
  }
}
