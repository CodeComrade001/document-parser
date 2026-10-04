import { DocumentFormatError } from "../../shared/errors/DocumentParserErrors.js";
import type { DocumentFormat } from "./DocumentTypes.js";

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PDF_SIGNATURE_SEARCH_WINDOW = 1024; // spec allows leading junk
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const BINARY_SNIFF_BYTES = 8192;
const HTML_SNIFF_BYTES = 1024;

const EXTENSION_FORMATS: Readonly<Record<string, DocumentFormat>> = {
  pdf: "pdf",
  docx: "docx",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
};

const MIME_FORMATS: Readonly<Record<string, DocumentFormat>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/plain": "text",
};

export interface FormatDetectionInput {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType?: string;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, PDF_SIGNATURE_SEARCH_WINDOW) - PDF_SIGNATURE.length;
  for (let offset = 0; offset <= limit; offset += 1) {
    if (startsWith(bytes, PDF_SIGNATURE, offset)) {
      return true;
    }
  }
  return false;
}

function formatFromExtension(fileName: string | undefined): DocumentFormat | undefined {
  if (fileName === undefined) return undefined;
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXTENSION_FORMATS[fileName.slice(dot + 1).toLowerCase()];
}

function formatFromMime(mimeType: string | undefined): DocumentFormat | undefined {
  if (mimeType === undefined) return undefined;
  const essence = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return MIME_FORMATS[essence];
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, HTML_SNIFF_BYTES)).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function containsNul(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * Determines the document format.
 *
 * Binary signatures are authoritative for PDF and ZIP-based formats. Declared
 * metadata (mime type, extension) is only trusted for text-like formats, where
 * no reliable signature exists. Conflicting evidence fails loudly rather than
 * guessing, because feeding a mislabelled file to the wrong extractor yields
 * confusing downstream errors.
 */
export class FormatDetector {
  public detect(input: FormatDetectionInput): DocumentFormat {
    const fromMime = formatFromMime(input.mimeType);
    const fromExtension = formatFromExtension(input.fileName);
    if (fromMime !== undefined && fromExtension !== undefined && fromMime !== fromExtension) {
      throw new DocumentFormatError(
        "FORMAT_MISMATCH",
        `mime type indicates ${fromMime} but file extension indicates ${fromExtension}`,
      );
    }
    const declared = fromMime ?? fromExtension;

    if (hasPdfSignature(input.bytes)) {
      if (declared !== undefined && declared !== "pdf") {
        throw new DocumentFormatError("FORMAT_MISMATCH", `content is a PDF but declared type is ${declared}`);
      }
      return "pdf";
    }

    if (startsWith(input.bytes, ZIP_SIGNATURE)) {
      if (declared === "docx") return "docx";
      if (declared === undefined) {
        throw new DocumentFormatError(
          "FORMAT_UNDETECTABLE",
          "content is a ZIP container; declare the type (e.g. .docx) so it can be routed",
        );
      }
      throw new DocumentFormatError("FORMAT_MISMATCH", `content is a ZIP container but declared type is ${declared}`);
    }

    if (declared === "pdf" || declared === "docx") {
      throw new DocumentFormatError("FORMAT_MISMATCH", `declared type is ${declared} but content has no matching signature`);
    }

    if (containsNul(input.bytes)) {
      throw new DocumentFormatError("FORMAT_UNSUPPORTED", "content looks binary and is not a supported format");
    }

    if (declared !== undefined) return declared;
    return looksLikeHtml(input.bytes) ? "html" : "text";
  }
}
