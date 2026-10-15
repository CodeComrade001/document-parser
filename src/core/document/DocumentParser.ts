import type { DocumentParserConfig } from "../../shared/config/DocumentParserConfig.js";
import {
  DocumentContentError,
  DocumentParserError,
  ExtractionError,
  ResultContractError,
} from "../../shared/errors/DocumentParserErrors.js";
import type { Logger } from "../../shared/logger/Logger.js";
import { DocumentChunker } from "../chunking/DocumentChunker.js";
import type { ExtractorRegistry } from "../extraction/ExtractorRegistry.js";
import { DocumentNormalizer } from "../normalization/DocumentNormalizer.js";
import type { SemanticExtractor } from "../semantic/SemanticExtractor.js";
import {
  formatZodIssues,
  type SemanticProfile,
} from "../semantic/SemanticProfile.js";
import {
  documentParserResultSchema,
  type DocumentParserResult,
} from "./DocumentParserResult.js";
import type { FormatDetector } from "./FormatDetector.js";
import { validatePayload } from "./PayloadValidator.js";
import type {
  DocumentParserPayload,
  DocumentSource,
} from "./DocumentTypes.js";

export interface DocumentParserDependencies {
  readonly config: DocumentParserConfig;
  readonly defaultProfile: SemanticProfile;
  readonly formatDetector: FormatDetector;
  readonly extractors: ExtractorRegistry;
  readonly normalizer: DocumentNormalizer;
  readonly chunker: DocumentChunker;
  readonly semanticExtractor: SemanticExtractor;
  readonly logger: Logger;
}

/**
 * Processes one document per call:
 *
 * validate -> detect format -> extract -> normalize -> chunk
 * -> semantic extraction -> validate output contract.
 *
 * All collaborators are injected, and no per-request state is retained.
 */
export class DocumentParser {
  public constructor(
    private readonly documentParserDeps: DocumentParserDependencies,
  ) { }

  public async parse(
    payload: DocumentParserPayload,
  ): Promise<DocumentParserResult> {
    const { config, logger } = this.documentParserDeps;
    const startedAt = Date.now();

    const input = validatePayload(payload, config.limits);

    const profile: SemanticProfile =
      input.semanticProfile ?? this.documentParserDeps.defaultProfile;

    const format = this.documentParserDeps.formatDetector.detect({
      bytes: input.bytes,
      ...(input.fileName === undefined
        ? {}
        : { fileName: input.fileName }),
      ...(input.mimeType === undefined
        ? {}
        : { mimeType: input.mimeType }),
    });

    const extractor = this.documentParserDeps.extractors.get(format);

    let raw: Awaited<ReturnType<typeof extractor.extract>>;

    try {
      raw = await extractor.extract({
        bytes: input.bytes,
        ...(input.fileName === undefined
          ? {}
          : { fileName: input.fileName }),
        ...(payload.file === undefined ? {} : { file: payload.file }),
      });
    } catch (error: unknown) {
      if (error instanceof DocumentParserError) {
        throw error;
      }

      throw new ExtractionError(`${format} extractor failed`, {
        cause: error,
      });
    }

    const source: DocumentSource = {
      format,
      byteLength: input.bytes.byteLength,
      ...(input.fileName === undefined
        ? {}
        : { fileName: input.fileName }),
      ...(input.mimeType === undefined
        ? {}
        : { mimeType: input.mimeType }),
    };

    const document = this.documentParserDeps.normalizer.normalize(
      raw,
      source,
      input.bytes,
    );

    const blockCount = document.sections.reduce(
      (total, section) => total + section.blocks.length,
      0,
    );

    if (blockCount === 0) {
      throw new DocumentContentError(
        "EMPTY_DOCUMENT",
        "no extractable text was found in the document",
      );
    }

    const chunks = this.documentParserDeps.chunker.chunk(document);

    if (chunks.length > config.limits.maxChunks) {
      throw new DocumentContentError(
        "DOCUMENT_TOO_LARGE",
        `document needs ${chunks.length} chunks, limit is ${config.limits.maxChunks}`,
        {
          details: {
            chunkCount: chunks.length,
            maxChunks: config.limits.maxChunks,
          },
        },
      );
    }

    logger.info("document.extracted", {
      documentId: document.id,
      format,
      sectionCount: document.sections.length,
      blockCount,
      tableCount: document.tables.length,
      chunkCount: chunks.length,
    });

    const semantic = await this.documentParserDeps.semanticExtractor.extract(
      document,
      chunks,
      profile,
    );

    const candidate = {
      document: semantic.document,
      semantic_concepts: profile.concepts.map(
        ({ key, description, category, aliases }) => ({
          key,
          description,
          category,
          aliases: [...aliases],
        }),
      ),
      relationships: profile.relationships.map(
        ({ key, description }) => ({
          key,
          description,
        }),
      ),
      entities: semantic.entities,
    };

    const validated = documentParserResultSchema.safeParse(candidate);

    if (!validated.success) {
      throw new ResultContractError(
        "assembled result violates the output contract",
        {
          details: {
            errors: formatZodIssues(validated.error),
          },
        },
      );
    }

    logger.info("document.parsed", {
      documentId: document.id,
      entityCount: validated.data.entities.length,
      durationMs: Date.now() - startedAt,
    });

    return validated.data;
  }
}