import { z } from "zod";

/**
 * The public output contract of the Document Parser (reference schema from the
 * requirements). This schema is the final gate: parse() never returns data that
 * has not passed it.
 *
 *   semantic_concepts -> WHAT the parser was looking for (from the profile)
 *   entities          -> WHAT was actually found, with source traceability
 *   relationships     -> relationship TYPES available in the profile
 */
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const MAX_CLASSIFICATION_LENGTH = 64;

export const classificationValueSchema = z
  .string()
  .max(MAX_CLASSIFICATION_LENGTH)
  .regex(SNAKE_CASE, "must be lower_snake_case");

export const documentClassificationSchema = z
  .object({
    document_type: classificationValueSchema,
    domain: classificationValueSchema,
  })
  .strict();

export const entitySourceSchema = z
  .object({
    section: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
  })
  .strict();

export const extractedEntitySchema = z
  .object({
    id: z.string().min(1),
    concept: z.string().min(1),
    value: z.string().min(1),
    source: entitySourceSchema,
  })
  .strict();

export const documentParserResultSchema = z
  .object({
    document: documentClassificationSchema,
    semantic_concepts: z.array(
      z
        .object({
          key: z.string().min(1),
          description: z.string().min(1),
          category: z.string().min(1),
          aliases: z.array(z.string()),
        })
        .strict(),
    ),
    relationships: z.array(z.object({ key: z.string().min(1), description: z.string().min(1) }).strict()),
    entities: z.array(extractedEntitySchema),
  })
  .strict()
  .superRefine((result, ctx) => {
    const conceptKeys = new Set(result.semantic_concepts.map((concept) => concept.key));
    const ids = new Set<string>();
    result.entities.forEach((entity, index) => {
      if (!conceptKeys.has(entity.concept)) {
        ctx.addIssue({
          code: "custom",
          path: ["entities", index, "concept"],
          message: `entity references undefined concept ${entity.concept}`,
        });
      }
      if (ids.has(entity.id)) {
        ctx.addIssue({ code: "custom", path: ["entities", index, "id"], message: `duplicate entity id ${entity.id}` });
      }
      ids.add(entity.id);
    });
  });

export type DocumentClassification = z.infer<typeof documentClassificationSchema>;
export type EntitySource = z.infer<typeof entitySourceSchema>;
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;
export type DocumentParserResult = z.infer<typeof documentParserResultSchema>;
