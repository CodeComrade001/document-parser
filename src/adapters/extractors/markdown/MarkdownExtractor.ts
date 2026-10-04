import type { DocumentFormat } from "../../../core/document/DocumentTypes.js";
import { ExtractionInput, IDocumentExtractor } from "../../../core/extraction/IDocumentExtractor.js";
import type { RawDocument, RawElement } from "../../../core/extraction/RawDocument.js";
import { decodeUtf8Strict } from "../text/decodeUtf8.js";

const ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(```|~~~)/;
const HORIZONTAL_RULE = /^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])[ \t]+\S/;
const BLOCKQUOTE = /^ {0,3}>\s?/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const SETEXT_H1 = /^ {0,3}=+\s*$/;
const SETEXT_H2 = /^ {0,3}-+\s*$/;
const FRONT_MATTER_DELIMITER = "---";

/** Removes inline markup that adds noise for downstream consumers. Raw HTML is left untouched. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "$1")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1");
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => stripInlineMarkdown(cell.trim()));
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    ATX_HEADING.test(line) ||
    FENCE.test(line) ||
    BLOCKQUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    HORIZONTAL_RULE.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next))
  );
}

interface FrontMatterResult {
  readonly bodyStart: number;
  readonly title?: string;
}

/** Skips a leading YAML front matter block; extracts a simple `title:` if present. */
function readFrontMatter(lines: readonly string[]): FrontMatterResult {
  if (lines[0]?.trim() !== FRONT_MATTER_DELIMITER) return { bodyStart: 0 };
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === FRONT_MATTER_DELIMITER) {
      const titleLine = lines.slice(1, i).find((line) => /^title\s*:/i.test(line));
      const title = titleLine?.replace(/^title\s*:\s*/i, "").replace(/^["']|["']$/g, "").trim();
      return title ? { bodyStart: i + 1, title } : { bodyStart: i + 1 };
    }
  }
  return { bodyStart: 0 }; // unterminated: treat as ordinary content
}

/**
 * Deterministic Markdown extractor (CommonMark subset: ATX/setext headings,
 * paragraphs, lists, block quotes, fenced code, pipe tables, front matter).
 * No dependencies. Raw HTML blocks are preserved as paragraph text.
 *
 * TODO(manual): swap for a full parser (e.g. remark/micromark) behind this same
 * interface if you need nested lists, reference links or HTML handling.
 */
export class MarkdownExtractor implements IDocumentExtractor {
  public readonly format: DocumentFormat = "markdown";

  // async so decoding errors surface as rejections, matching the DocumentExtractor contract
  // eslint-disable-next-line @typescript-eslint/require-await
  public async extract(input: ExtractionInput): Promise<RawDocument> {
    const lines = decodeUtf8Strict(input.bytes).replace(/\r\n?/g, "\n").split("\n");
    const frontMatter = readFrontMatter(lines);
    const elements: RawElement[] = [];
    let i = frontMatter.bodyStart;

    while (i < lines.length) {
      const line = lines[i] ?? "";
      const next = lines[i + 1];

      if (line.trim() === "" || HORIZONTAL_RULE.test(line)) {
        i += 1;
        continue;
      }

      const fence = FENCE.exec(line);
      if (fence?.[1] !== undefined) {
        const marker = fence[1];
        const code: string[] = [];
        i += 1;
        while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker)) {
          code.push(lines[i] ?? "");
          i += 1;
        }
        i += 1; // closing fence (or EOF)
        if (code.some((c) => c.trim() !== "")) elements.push({ type: "paragraph", text: code.join("\n") });
        continue;
      }

      const atx = ATX_HEADING.exec(line);
      if (atx?.[1] !== undefined && atx[2] !== undefined) {
        elements.push({ type: "heading", level: atx[1].length, text: stripInlineMarkdown(atx[2]) });
        i += 1;
        continue;
      }

      if (line.includes("|") && next !== undefined && TABLE_SEPARATOR.test(next)) {
        const rows: string[][] = [splitTableRow(line)];
        i += 2;
        while (i < lines.length && (lines[i] ?? "").trim() !== "" && (lines[i] ?? "").includes("|")) {
          rows.push(splitTableRow(lines[i] ?? ""));
          i += 1;
        }
        elements.push({ type: "table", rows });
        continue;
      }

      if (BLOCKQUOTE.test(line)) {
        const quote: string[] = [];
        while (i < lines.length && BLOCKQUOTE.test(lines[i] ?? "")) {
          quote.push(stripInlineMarkdown((lines[i] ?? "").replace(BLOCKQUOTE, "")));
          i += 1;
        }
        elements.push({ type: "quote", text: quote.join("\n") });
        continue;
      }

      if (LIST_ITEM.test(line)) {
        const items: string[] = [];
        while (i < lines.length) {
          const item = lines[i] ?? "";
          if (LIST_ITEM.test(item)) {
            items.push(stripInlineMarkdown(item.trim()));
          } else if (item.trim() !== "" && /^\s{2,}\S/.test(item) && items.length > 0) {
            items[items.length - 1] += ` ${stripInlineMarkdown(item.trim())}`; // continuation line
          } else {
            break;
          }
          i += 1;
        }
        elements.push({ type: "list", text: items.join("\n") });
        continue;
      }

      // Paragraph (or setext heading when a single line is underlined).
      const paragraph: string[] = [line];
      i += 1;
      while (i < lines.length) {
        const candidate = lines[i] ?? "";
        if (paragraph.length === 1 && (SETEXT_H1.test(candidate) || SETEXT_H2.test(candidate))) {
          elements.push({
            type: "heading",
            level: SETEXT_H1.test(candidate) ? 1 : 2,
            text: stripInlineMarkdown((paragraph[0] ?? "").trim()),
          });
          paragraph.length = 0;
          i += 1;
          break;
        }
        if (candidate.trim() === "" || startsBlock(candidate, lines[i + 1])) break;
        paragraph.push(candidate);
        i += 1;
      }
      if (paragraph.length > 0) {
        elements.push({ type: "paragraph", text: stripInlineMarkdown(paragraph.map((p) => p.trim()).join("\n")) });
      }
    }

    return {
      metadata: frontMatter.title === undefined ? {} : { title: frontMatter.title },
      elements,
    };
  }
}
