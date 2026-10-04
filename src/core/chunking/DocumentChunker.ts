import { CHUNK_BLOCK_OVERHEAD_CHARS, type DocumentLimits } from "../../shared/config/DocumentParserConfig.js";
import type { BlockType, ParsedDocument } from "../document/DocumentTypes.js";

/** One labelled piece of text inside a chunk. Pieces of an oversized block share its blockId. */
export interface ChunkBlock {
  readonly blockId: string;
  readonly type: BlockType;
  readonly text: string;
  readonly sectionId: string;
  readonly sectionTitle?: string;
  readonly pageNumber?: number;
}

export interface DocumentChunk {
  readonly id: string;
  readonly index: number;
  readonly blocks: readonly ChunkBlock[];
  readonly charCount: number;
}

const BOUNDARY_SEARCH_FLOOR_RATIO = 0.5;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Splits text into pieces of at most `maxChars`, preferring paragraph, sentence,
 * then word boundaries, and never splitting a surrogate pair.
 */
export function splitOversizedText(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const floor = Math.floor(maxChars * BOUNDARY_SEARCH_FLOOR_RATIO);
    const window = rest.slice(0, maxChars);
    let cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". ") + 1, window.lastIndexOf(" "));
    if (cut < floor) {
      cut = maxChars;
      if (isHighSurrogate(rest.charCodeAt(cut - 1))) cut -= 1;
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") pieces.push(rest);
  return pieces.filter((piece) => piece !== "");
}

/**
 * Groups blocks into LLM-sized chunks.
 *
 * Rules:
 *  - document order is preserved
 *  - blocks are never merged or reordered; only oversized blocks are split
 *  - a chunk is closed at a section boundary once it reaches minChunkChars, so
 *    chunks tend to align with sections without producing tiny chunks
 *  - every piece keeps its blockId, section and page for traceability
 */
export class DocumentChunker {
  public constructor(private readonly limits: Pick<DocumentLimits, "maxChunkChars" | "minChunkChars">) {}

  public chunk(document: ParsedDocument): DocumentChunk[] {
    const maxTextChars = this.limits.maxChunkChars - CHUNK_BLOCK_OVERHEAD_CHARS;
    const chunks: DocumentChunk[] = [];
    let blocks: ChunkBlock[] = [];
    let charCount = 0;
    let currentSectionId: string | undefined;

    const flush = (): void => {
      if (blocks.length === 0) return;
      const index = chunks.length;
      chunks.push({ id: `c${index + 1}`, index, blocks, charCount });
      blocks = [];
      charCount = 0;
    };

    for (const section of document.sections) {
      let isSectionStart = true;
      for (const block of section.blocks) {
        const pieces =
          block.content.length > maxTextChars ? splitOversizedText(block.content, maxTextChars) : [block.content];

        for (const text of pieces) {
          const cost = text.length + CHUNK_BLOCK_OVERHEAD_CHARS;
          const startsNewSection = isSectionStart && currentSectionId !== undefined && currentSectionId !== section.id;
          if (blocks.length > 0 && (charCount + cost > this.limits.maxChunkChars ||
              (startsNewSection && charCount >= this.limits.minChunkChars))) {
            flush();
          }
          blocks.push({
            blockId: block.id,
            type: block.type,
            text,
            sectionId: section.id,
            ...(section.title === undefined ? {} : { sectionTitle: section.title }),
            ...(block.pageNumber === undefined ? {} : { pageNumber: block.pageNumber }),
          });
          charCount += cost;
          currentSectionId = section.id;
          isSectionStart = false;
        }
      }
    }
    flush();
    return chunks;
  }
}
