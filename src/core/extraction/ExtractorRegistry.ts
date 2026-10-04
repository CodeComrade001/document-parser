import { ConfigurationError, DocumentFormatError } from "../../shared/errors/DocumentParserErrors.js";
import type { DocumentFormat } from "../document/DocumentTypes.js";
import type { IDocumentExtractor } from "./IDocumentExtractor.js";

export class ExtractorRegistry {
  private readonly extractors = new Map<DocumentFormat, IDocumentExtractor>();

  public constructor(extractors: readonly IDocumentExtractor[] = []) {
    extractors.forEach((extractor) => this.register(extractor));
  }

  public register(extractor: IDocumentExtractor): void {
    if (this.extractors.has(extractor.format)) {
      throw new ConfigurationError(`an extractor for ${extractor.format} is already registered`);
    }
    this.extractors.set(extractor.format, extractor);
  }

  public get(format: DocumentFormat): IDocumentExtractor {
    const extractor = this.extractors.get(format);
    if (extractor === undefined) {
      throw new DocumentFormatError(
        "FORMAT_UNSUPPORTED",
        `no extractor is registered for ${format}`,
        { details: { format, registered: this.formats() } },
      );
    }
    return extractor;
  }

  public formats(): DocumentFormat[] {
    return [...this.extractors.keys()];
  }
}
