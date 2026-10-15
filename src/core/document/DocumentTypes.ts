import { Readable } from "node:stream";
import type { SemanticProfile } from "../semantic/SemanticProfile.js";

export const DOCUMENT_FORMATS = ["pdf", "docx", "html", "markdown", "text"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** Public input of DocumentParser.parse(). */
export interface DocumentParserPayload {
  /** Raw file bytes, or already-decoded text. */
  readonly content: Uint8Array | string;
  /**
   * Original file name. Used ONLY as a format hint (extension); it is never
   * used to touch the filesystem.
   */
  readonly file?: Readable;
  readonly fileName?: string;
  readonly mimeType?: string;
  /** Per-call override of the semantic profile configured at bootstrap. Validated before use. */
  readonly semanticProfile?: SemanticProfile;
}

// ---------------------------------------------------------------------------
// Normalized document model (format independent; see FRD section 8)
// ---------------------------------------------------------------------------

export interface DocumentSource {
  readonly format: DocumentFormat;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly byteLength: number;
}

export interface DocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly language?: string;
  readonly pageCount?: number;
}

export type BlockType = "paragraph" | "heading" | "list" | "table" | "quote";

export interface DocumentBlock {
  /** Stable within a ParsedDocument ("b1", "b2", ...). The LLM references blocks by this id. */
  readonly id: string;
  readonly type: BlockType;
  readonly content: string;
  readonly pageNumber?: number;
}

export interface DocumentSection {
  readonly id: string;
  /** Undefined for the preamble (content before the first heading). */
  readonly title?: string;
  /** 0 for the preamble, otherwise the heading level (1-6). */
  readonly level: number;
  /** Includes the heading block itself as the first block (when title is defined). */
  readonly blocks: readonly DocumentBlock[];
}

export interface DocumentPage {
  readonly pageNumber: number;
  readonly blockIds: readonly string[];
}

export interface DocumentTable {
  readonly id: string;
  readonly blockId: string;
  readonly sectionId: string;
  readonly rows: readonly (readonly string[])[];
  readonly pageNumber?: number;
}

export interface ParsedDocument {
  readonly id: string;
  readonly source: DocumentSource;
  readonly metadata: DocumentMetadata;
  /** Empty when the format has no page concept (text, markdown, html). */
  readonly pages: readonly DocumentPage[];
  readonly sections: readonly DocumentSection[];
  readonly tables: readonly DocumentTable[];
}
