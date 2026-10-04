/**
 * Minimal logging port.
 *
 * TODO(manual): provide a production implementation (pino/winston/etc.) that
 * satisfies this interface and pass it to DocumentParserConstructor.
 * The parser never logs document content, prompts, or credentials - only
 * structural metadata (stage names, counts, timings, token usage).
 */
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
