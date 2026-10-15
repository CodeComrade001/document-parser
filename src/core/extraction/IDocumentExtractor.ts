import { Readable } from "node:stream";
import type { DocumentFormat } from "../document/DocumentTypes.js";
import type { RawDocument } from "./RawDocument.js";

export interface ExtractionInput {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly file?: Readable
}

/**
 * Port implemented by src/adapters/extractors/*.
 *
 * Contract:
 *  - deterministic: same bytes => same RawDocument
 *  - MUST NOT call an LLM or the network
 *  - MUST enforce its own format-specific safety limits (e.g. decompressed size
 *    for ZIP-based formats, page count for PDFs) and throw ExtractionError
 *  - reports page numbers (1-based) when the format has pages
 */
export interface IDocumentExtractor {
  readonly format: DocumentFormat;
  extract(input: ExtractionInput): Promise<RawDocument>;
}
