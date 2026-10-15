import {
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

import type { DocumentFormat } from "../../../core/document/DocumentTypes.js";
import type { ExtractionInput } from "../../../core/extraction/IDocumentExtractor.js";
import type { IDocumentExtractor } from "../../../core/extraction/IDocumentExtractor.js";
import type {
  RawDocument,
  RawElement,
} from "../../../core/extraction/RawDocument.js";

const PDF_HEADER = new TextEncoder().encode("%PDF-");

export class PdfExtractor implements IDocumentExtractor {
  public readonly format: DocumentFormat = "pdf";

  public async extract(
    input: ExtractionInput,
  ): Promise<RawDocument> {
    const bytes = this.getInputBytes(input);

    this.validatePdfHeader(bytes);

    const loadingTask = getDocument({
      data: bytes,
      useSystemFonts: true,
    });

    try {
      const pdf: PDFDocumentProxy = await loadingTask.promise;

      if (pdf.numPages < 1) {
        throw new Error("PDF contains no pages");
      }

      const elements: RawElement[] = [];
      const textParts: string[] = [];

      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber += 1
      ) {
        const page = await pdf.getPage(pageNumber);

        try {
          const textContent = await page.getTextContent();

          const pageText = textContent.items
            .filter(
              (item): item is typeof item & { str: string } =>
                "str" in item &&
                typeof item.str === "string",
            )
            .map((item) => item.str)
            .join(" ")
            .replace(/[ \t]+/g, " ")
            .trim();

          textParts.push(pageText);

          if (pageText.length > 0) {
            elements.push({
              type: "paragraph",
              text: pageText,
              pageNumber,
            });
          }
        } finally {
          page.cleanup();
        }
      }

      const metadata = await pdf.getMetadata();
      const info = metadata.info;

      let title: string | undefined;
      let author: string | undefined;

      if (typeof info === "object" && info !== null) {
        if ("Title" in info && typeof info.Title === "string") {
          title = info.Title.trim() || undefined;
        }

        if ("Author" in info && typeof info.Author === "string") {
          author = info.Author.trim() || undefined;
        }
      }

      return {
        metadata: {
          pageCount: pdf.numPages,
          ...(title === undefined ? {} : { title }),
          ...(author === undefined ? {} : { author }),
        },
        elements,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.startsWith("PDF ")
      ) {
        throw error;
      }

      throw new Error(
        `Failed to extract PDF: ${error instanceof Error
          ? error.message
          : "Unknown extraction error"
        } `,
        { cause: error },
      );
    } finally {
      await loadingTask.destroy();
    }
  }

  private getInputBytes(
    input: ExtractionInput,
  ): Uint8Array {
    const bytes = input.bytes;

    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0
    ) {
      throw new Error(
        "PDF content must be a non-empty Uint8Array",
      );
    }

    return Uint8Array.from(bytes);
  }

  private validatePdfHeader(bytes: Uint8Array): void {
    if (
      bytes.byteLength < PDF_HEADER.length ||
      !PDF_HEADER.every(
        (byte, index) => bytes[index] === byte,
      )
    ) {
      throw new Error(
        "PDF content does not have a valid PDF header",
      );
    }
  }
}
