import { createHash } from "node:crypto";
import { ExtractionError } from "../../shared/errors/DocumentParserErrors.js";
import type {
  BlockType,
  DocumentBlock,
  DocumentMetadata,
  DocumentPage,
  DocumentSection,
  DocumentSource,
  DocumentTable,
  ParsedDocument,
} from "../document/DocumentTypes.js";
import type { RawDocument, RawElement } from "../extraction/RawDocument.js";

const MIN_HEADING_LEVEL = 1;
const MAX_HEADING_LEVEL = 6;
const TABLE_CELL_SEPARATOR = " | ";
const DOCUMENT_ID_HASH_CHARS = 16;

// Control characters except \t (0x09) and \n (0x0a). \r is handled separately.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Canonical text cleanup shared by every format. Keeps line breaks, collapses noise. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertPageNumber(pageNumber: number | undefined): void {
  if (pageNumber !== undefined && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
    throw new ExtractionError(`extractor produced an invalid page number: ${String(pageNumber)}`);
  }
}

interface MutableSection {
  id: string;
  title?: string;
  level: number;
  blocks: DocumentBlock[];
}

/**
 * Converts a RawDocument into the format-independent ParsedDocument.
 *
 * Responsibilities: text cleanup, section construction from headings, stable
 * ids, page index, table index. Page numbers are carried on every block so
 * source traceability survives all later stages.
 *
 * This class is stateless; it is safe to share across concurrent parses.
 */
export class DocumentNormalizer {
  public normalize(raw: RawDocument, source: DocumentSource, bytes: Uint8Array): ParsedDocument {
    const sections: MutableSection[] = [];
    const tables: DocumentTable[] = [];
    let blockCounter = 0;
    let sectionCounter = 0;
    let tableCounter = 0;

    const openSection = (title: string | undefined, level: number): MutableSection => {
      sectionCounter += 1;
      const section: MutableSection = { id: `s${sectionCounter}`, level, blocks: [] };
      if (title !== undefined) section.title = title;
      sections.push(section);
      return section;
    };

    const makeBlock = (type: BlockType, content: string, pageNumber: number | undefined): DocumentBlock => {
      blockCounter += 1;
      const id = `b${blockCounter}`;
      return pageNumber === undefined ? { id, type, content } : { id, type, content, pageNumber };
    };

    let current: MutableSection | undefined;

    for (const element of raw.elements) {
      assertPageNumber(element.pageNumber);

      if (element.type === "heading") {
        const title = normalizeText(element.text).replace(/\n/g, " ");
        if (title === "") continue;
        const level = Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, Math.trunc(element.level)));
        current = openSection(title, level);
        current.blocks.push(makeBlock("heading", title, element.pageNumber));
        continue;
      }

      const content = this.contentOf(element);
      if (content === undefined) continue;

      current ??= openSection(undefined, 0);
      const block = makeBlock(element.type, content.text, element.pageNumber);
      current.blocks.push(block);

      if (element.type === "table" && content.rows !== undefined) {
        tableCounter += 1;
        const table: DocumentTable = {
          id: `t${tableCounter}`,
          blockId: block.id,
          sectionId: current.id,
          rows: content.rows,
          ...(element.pageNumber === undefined ? {} : { pageNumber: element.pageNumber }),
        };
        tables.push(table);
      }
    }

    const finalSections: DocumentSection[] = sections.map((section) => ({
      id: section.id,
      level: section.level,
      blocks: section.blocks,
      ...(section.title === undefined ? {} : { title: section.title }),
    }));

    return {
      id: `doc-${createHash("sha256").update(bytes).digest("hex").slice(0, DOCUMENT_ID_HASH_CHARS)}`,
      source,
      metadata: this.normalizeMetadata(raw),
      pages: this.buildPages(finalSections),
      sections: finalSections,
      tables,
    };
  }

  private contentOf(element: Exclude<RawElement, { type: "heading" }>):
    | { text: string; rows?: readonly (readonly string[])[] }
    | undefined {
    if (element.type === "table") {
      const rows = element.rows
        .map((row) => row.map((cell) => normalizeText(cell).replace(/\n/g, " ")))
        .filter((row) => row.some((cell) => cell !== ""));
      if (rows.length === 0) return undefined;
      return { text: rows.map((row) => row.join(TABLE_CELL_SEPARATOR)).join("\n"), rows };
    }
    const text = normalizeText(element.text);
    return text === "" ? undefined : { text };
  }

  private normalizeMetadata(raw: RawDocument): DocumentMetadata {
    const { title, author, language, pageCount } = raw.metadata;
    const normalizedTitle = title === undefined ? "" : normalizeText(title);
    const normalizedAuthor = author === undefined ? "" : normalizeText(author);
    return {
      ...(normalizedTitle === "" ? {} : { title: normalizedTitle }),
      ...(normalizedAuthor === "" ? {} : { author: normalizedAuthor }),
      ...(language === undefined || language.trim() === "" ? {} : { language: language.trim() }),
      ...(pageCount === undefined ? {} : { pageCount }),
    };
  }

  private buildPages(sections: readonly DocumentSection[]): DocumentPage[] {
    const byPage = new Map<number, string[]>();
    for (const section of sections) {
      for (const block of section.blocks) {
        if (block.pageNumber === undefined) continue;
        const ids = byPage.get(block.pageNumber) ?? [];
        ids.push(block.id);
        byPage.set(block.pageNumber, ids);
      }
    }
    return [...byPage.entries()]
      .sort(([a], [b]) => a - b)
      .map(([pageNumber, blockIds]) => ({ pageNumber, blockIds }));
  }
}
