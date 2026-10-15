import { DocumentFormat } from "../document/DocumentTypes";

/**
 * Output of a deterministic extractor, before normalization.
 * Extractors report what the file physically contains; they do not interpret it.
 */
export type RawElement =
  | { readonly type: "heading"; readonly text: string; readonly level: number; readonly pageNumber?: number }
  | { readonly type: "paragraph" | "list" | "quote"; readonly text: string; readonly pageNumber?: number }
  | { readonly type: "table"; readonly rows: readonly (readonly string[])[]; readonly pageNumber?: number };

export interface RawDocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly language?: string;
  readonly pageCount?: number;
}

export interface RawDocument {
  readonly metadata: RawDocumentMetadata;
  /** Elements in reading order. */
  readonly elements: readonly RawElement[];
}
