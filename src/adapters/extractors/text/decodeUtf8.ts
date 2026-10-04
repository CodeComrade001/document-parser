import { ExtractionError } from "../../../shared/errors/DocumentParserErrors.js";

const UTF8_BOM = "\uFEFF";

/** Strict UTF-8 decode. Invalid bytes fail loudly instead of becoming U+FFFD. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  } catch (error) {
    throw new ExtractionError("document is not valid UTF-8 text", { cause: error });
  }
}
