import type { DocumentFormat } from "../../../core/document/DocumentTypes.js";
import type { ExtractionInput, IDocumentExtractor } from "../../../core/extraction/IDocumentExtractor.js";
import type { RawDocument, RawElement } from "../../../core/extraction/RawDocument.js";
import { decodeUtf8Strict } from "./decodeUtf8.js";

const LIST_LINE = /^\s*(?:[-*\u2022]|\d+[.)])\s+\S/;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)[.)]?\s+(\S.*)$/;
const ALL_CAPS_HEADING = /^[A-Z][A-Z0-9 &/\-:,()]+$/;
const TRAILING_COLON_HEADING = /^([A-Z][^.!?:]*):$/;
const SENTENCE_END = /[.!?;,]$/;

const MAX_NUMBERED_HEADING_WORDS = 12;
const MAX_TITLE_HEADING_CHARS = 60;
const MAX_TITLE_HEADING_WORDS = 8;
const MAX_ALL_CAPS_HEADING_CHARS = 80;
const MIN_ALL_CAPS_LETTERS = 3;
const MAX_HEADING_LEVEL = 6;

export interface DetectedHeading {
  readonly text: string;
  readonly level: number;
}

function wordCount(line: string): number {
  return line.split(/\s+/).filter(Boolean).length;
}

/**
 * Conservative heuristic for headings in unstructured plain text.
 *
 * Applied only to single-line paragraphs. It is a structural hint, NOT
 * semantic interpretation: false negatives merely produce larger sections,
 * and the LLM decides meaning later. Rules, in priority order:
 *   1. numbered ("2.1 Root Cause")        -> level = depth
 *   2. ALL CAPS short line                -> level 1
 *   3. short line ending with ":"         -> level 2
 *   4. short title-like line (no final punctuation) followed by more text -> level 2
 */
export function detectTextHeading(line: string, hasFollowingContent: boolean): DetectedHeading | undefined {
  const text = line.trim();
  if (text === "" || text.includes("\n")) return undefined;

  const numbered = NUMBERED_HEADING.exec(text);
  if (numbered?.[1] !== undefined && numbered[2] !== undefined) {
    const title = numbered[2];
    if (!SENTENCE_END.test(title) && wordCount(title) <= MAX_NUMBERED_HEADING_WORDS) {
      return { text: title, level: Math.min(MAX_HEADING_LEVEL, numbered[1].split(".").length) };
    }
    return undefined;
  }

  const letters = text.replace(/[^A-Za-z]/g, "").length;
  if (text.length <= MAX_ALL_CAPS_HEADING_CHARS && letters >= MIN_ALL_CAPS_LETTERS && ALL_CAPS_HEADING.test(text)) {
    return { text, level: 1 };
  }

  const colon = TRAILING_COLON_HEADING.exec(text);
  if (colon?.[1] !== undefined && text.length <= MAX_TITLE_HEADING_CHARS) {
    return { text: colon[1].trim(), level: 2 };
  }

  if (
    hasFollowingContent &&
    text.length <= MAX_TITLE_HEADING_CHARS &&
    wordCount(text) <= MAX_TITLE_HEADING_WORDS &&
    /^[A-Z]/.test(text) &&
    !SENTENCE_END.test(text)
  ) {
    return { text, level: 2 };
  }
  return undefined;
}

/** Splits text into paragraphs separated by one or more blank lines. */
function splitParagraphs(text: string): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      if (current.length > 0) paragraphs.push(current);
      current = [];
    } else {
      current.push(line.trimEnd());
    }
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

/** Deterministic plain-text extractor. No dependencies. */
export class TextExtractor implements IDocumentExtractor {
  public readonly format: DocumentFormat = "text";

  // async so decoding errors surface as rejections, matching the DocumentExtractor contract
  // eslint-disable-next-line @typescript-eslint/require-await
  public async extract(input: ExtractionInput): Promise<RawDocument> {
    const text = decodeUtf8Strict(input.bytes);
    const paragraphs = splitParagraphs(text);
    const elements: RawElement[] = [];

    paragraphs.forEach((lines, index) => {
      const isList = lines.every((line) => LIST_LINE.test(line));
      const first = lines[0];
      if (lines.length === 1 && first !== undefined) {
        const heading = detectTextHeading(first, index < paragraphs.length - 1);
        if (heading !== undefined) {
          elements.push({ type: "heading", text: heading.text, level: heading.level });
          return;
        }
      }
      elements.push({ type: isList ? "list" : "paragraph", text: lines.join("\n") });
    });

    return { metadata: {}, elements };
  }
}
