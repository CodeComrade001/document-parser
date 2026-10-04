import { z } from "zod";
import type { LLMProcessingConfig } from "../../shared/config/DocumentParserConfig.js";
import type { Logger } from "../../shared/logger/Logger.js";
import type { DocumentChunk } from "../chunking/DocumentChunker.js";
import {
  documentClassificationSchema,
  type DocumentClassification,
  type EntitySource,
  type ExtractedEntity,
} from "../document/DocumentParserResult.js";
import type { ParsedDocument } from "../document/DocumentTypes.js";
import { assembleEntities, type CandidateEntity } from "./EntityAssembler.js";
import { mapWithConcurrency } from "./mapWithConcurrency.js";
import type { SemanticPromptBuilder } from "./SemanticPrompts.js";
import type { SemanticProfile } from "./SemanticProfile.js";
import type { StructuredGenerator } from "./StructuredGenerator.js";

const MAX_DIGEST_HEADINGS = 60;

export interface SemanticExtractionResult {
  readonly document: DocumentClassification;
  readonly entities: ExtractedEntity[];
}

export type SemanticExtractorConfig = Pick<
  LLMProcessingConfig,
  "chunkConcurrency" | "classificationDigestChars" | "maxEntityValueChars"
>;

/**
 * Compact, bounded description of a document for classification: title,
 * heading outline, then the opening text. Deterministic; contains no LLM output.
 */
export function buildClassificationDigest(document: ParsedDocument, maxChars: number): string {
  const parts: string[] = [];
  if (document.metadata.title !== undefined) parts.push(`Title: ${document.metadata.title}`);

  const headings = document.sections
    .filter((section) => section.title !== undefined)
    .slice(0, MAX_DIGEST_HEADINGS)
    .map((section) => `${"  ".repeat(Math.max(0, section.level - 1))}- ${section.title ?? ""}`);
  if (headings.length > 0) parts.push(`Headings:\n${headings.join("\n")}`);

  const opening = document.sections
    .flatMap((section) => section.blocks)
    .filter((block) => block.type !== "heading")
    .map((block) => block.content)
    .join("\n");
  parts.push(`Opening text:\n${opening}`);

  const digest = parts.join("\n\n");
  return digest.length > maxChars ? digest.slice(0, maxChars) : digest;
}

/** Builds a validator bound to one chunk: concepts and block ids must exist. */
function buildChunkSchema(
  conceptKeys: ReadonlySet<string>,
  blockIds: ReadonlySet<string>,
  maxValueChars: number,
) {
  return z
    .object({
      entities: z.array(
        z
          .object({
            concept: z.string(),
            value: z.string().trim().min(1).max(maxValueChars),
            source_block: z.string(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((output, ctx) => {
      output.entities.forEach((entity, index) => {
        if (!conceptKeys.has(entity.concept)) {
          ctx.addIssue({
            code: "custom",
            path: ["entities", index, "concept"],
            message: `"${entity.concept}" is not a defined concept; use one of: ${[...conceptKeys].join(", ")}`,
          });
        }
        if (!blockIds.has(entity.source_block)) {
          ctx.addIssue({
            code: "custom",
            path: ["entities", index, "source_block"],
            message: `"${entity.source_block}" is not a block id in this excerpt; use one of: ${[...blockIds].join(", ")}`,
          });
        }
      });
    });
}

/**
 * Orchestrates semantic interpretation:
 *   1. classify the document (one call, bounded digest)
 *   2. extract entities per chunk (bounded concurrency)
 *   3. resolve each entity's source (section, page) DETERMINISTICALLY from the
 *      block id it cites - the LLM never asserts page or section itself
 *   4. merge, de-duplicate and assign ids
 *
 * A failure in any chunk fails the whole parse: returning partial entities
 * without saying so would be a silent data-quality bug.
 */
export class SemanticExtractor {
  public constructor(
    private readonly generator: StructuredGenerator,
    private readonly prompts: SemanticPromptBuilder,
    private readonly config: SemanticExtractorConfig,
    private readonly logger: Logger,
  ) {}

  public async extract(
    document: ParsedDocument,
    chunks: readonly DocumentChunk[],
    profile: SemanticProfile,
  ): Promise<SemanticExtractionResult> {
    const classification = await this.classify(document, profile);
    const sourceByBlock = this.indexSources(document);
    const conceptKeys = new Set(profile.concepts.map((concept) => concept.key));

    const perChunk = await mapWithConcurrency(chunks, this.config.chunkConcurrency, async (chunk) => {
      const blockIds = new Set(chunk.blocks.map((block) => block.blockId));
      const schema = buildChunkSchema(conceptKeys, blockIds, this.config.maxEntityValueChars);
      const request = this.prompts.buildExtraction({ chunk, classification, profile });
      const { value } = await this.generator.generate(request, schema);

      const candidates: CandidateEntity[] = value.entities.map((entity) => ({
        concept: entity.concept,
        value: entity.value,
        source: sourceByBlock.get(entity.source_block) ?? {},
      }));
      this.logger.debug("semantic.chunk.extracted", { chunkId: chunk.id, entityCount: candidates.length });
      return candidates;
    });

    const entities = assembleEntities(perChunk.flat(), profile);
    this.logger.info("semantic.extraction.completed", {
      chunkCount: chunks.length,
      entityCount: entities.length,
      documentType: classification.document_type,
      domain: classification.domain,
    });
    return { document: classification, entities };
  }

  private async classify(document: ParsedDocument, profile: SemanticProfile): Promise<DocumentClassification> {
    const digest = buildClassificationDigest(document, this.config.classificationDigestChars);
    const request = this.prompts.buildClassification({ digest, profile });
    const { value } = await this.generator.generate(request, documentClassificationSchema);
    return value;
  }

  private indexSources(document: ParsedDocument): Map<string, EntitySource> {
    const index = new Map<string, EntitySource>();
    for (const section of document.sections) {
      for (const block of section.blocks) {
        index.set(block.id, {
          ...(section.title === undefined ? {} : { section: section.title }),
          ...(block.pageNumber === undefined ? {} : { page: block.pageNumber }),
        });
      }
    }
    return index;
  }
}
