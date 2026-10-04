import { MarkdownExtractor } from "../adapters/extractors/markdown/MarkdownExtractor.js";
import { TextExtractor } from "../adapters/extractors/text/TextExtractor.js";
import {
  resolveDocumentParserConfig,
  type DocumentParserConfigOverrides,
} from "../shared/config/DocumentParserConfig.js";
import { ConfigurationError } from "../shared/errors/DocumentParserErrors.js";
import { noopLogger, type Logger } from "../shared/logger/Logger.js";
import { DocumentChunker } from "./chunking/DocumentChunker.js";
import type { IDocumentExtractor } from "./extraction/IDocumentExtractor.js";
import { ExtractorRegistry } from "./extraction/ExtractorRegistry.js";
import type { LLMProvider } from "./llm/LLMProvider.js";
import { DocumentNormalizer } from "./normalization/DocumentNormalizer.js";
import { SemanticExtractor } from "./semantic/SemanticExtractor.js";
import { SemanticPromptBuilder } from "./semantic/SemanticPrompts.js";
import { validateSemanticProfile } from "./semantic/SemanticProfile.js";
import { StructuredGenerator } from "./semantic/StructuredGenerator.js";
import type { DocumentParserResult } from "./document/DocumentParserResult.js";
import { DocumentParser } from "./document/DocumentParser.js";
import type { DocumentParserPayload } from "./document/DocumentTypes.js";
import { FormatDetector } from "./document/FormatDetector.js";

export interface DocumentParserExecute {
  parse: (payload: DocumentParserPayload) => Promise<DocumentParserResult>;
}

export interface IDocumentParserConstructorResponse {
  document: DocumentParserExecute;
}

export interface DocumentParserConstructorDependencies {
  /** Any LLMProvider (local, google, future). See adapters/llm/LLMProviderFactory.ts. */
  readonly llmProvider: LLMProvider;
  /**
   * Default semantic profile (the concepts to look for).
   * TODO(manual): supply your document-specific profile.
   */
  readonly semanticProfile: unknown;
  /**
   * Extractors in addition to the built-in text and markdown ones. An extractor
   * for an already-registered format replaces the built-in.
   *
   * TODO(manual): provide pdf, docx and html DocumentExtractor implementations
   * backed by the libraries you choose. Until then those formats fail with
   * FORMAT_UNSUPPORTED rather than being faked.
   */
  readonly extractors?: readonly IDocumentExtractor[];
  readonly config?: DocumentParserConfigOverrides;
  readonly logger?: Logger;
}

/**
 * Composition root. The consuming application only sees `document.parse`.
 *
 *   const parser = new DocumentParserConstructor({ llmProvider, semanticProfile }).init();
 *   const result = await parser.document.parse({ content, fileName });
 */
export class DocumentParserConstructor {
  public constructor(private readonly dependencies: DocumentParserConstructorDependencies) { }

  public init(): IDocumentParserConstructorResponse {
    const { llmProvider, extractors = [] } = this.dependencies;
    const logger = this.dependencies.logger ?? noopLogger;
    const config = resolveDocumentParserConfig(this.dependencies.config);

    const profileValidation = validateSemanticProfile(this.dependencies.semanticProfile);
    if (!profileValidation.ok) {
      throw new ConfigurationError(`semanticProfile is invalid: ${profileValidation.issues.join("; ")}`);
    }

    // Later entries win, so callers can replace a built-in extractor.
    const byFormat = new Map<string, IDocumentExtractor>();
    for (const extractor of [new TextExtractor(), new MarkdownExtractor(), ...extractors]) {
      byFormat.set(extractor.format, extractor);
    }

    const prompts = new SemanticPromptBuilder({
      temperature: config.llm.temperature,
      maxOutputTokens: config.llm.maxOutputTokens,
    });
    const generator = new StructuredGenerator(llmProvider, prompts, config.llm, logger);
    const parser = new DocumentParser({
      config,
      defaultProfile: profileValidation.profile,
      formatDetector: new FormatDetector(),
      extractors: new ExtractorRegistry([...byFormat.values()]),
      normalizer: new DocumentNormalizer(),
      chunker: new DocumentChunker(config.limits),
      semanticExtractor: new SemanticExtractor(generator, prompts, config.llm, logger),
      logger,
    });

    return {
      document: {
        parse: (payload: DocumentParserPayload) => parser.parse(payload),
      },
    };
  }
}
