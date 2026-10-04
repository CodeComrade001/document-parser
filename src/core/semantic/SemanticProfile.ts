import { z } from "zod";

/**
 * A SemanticProfile defines WHAT the parser looks for in a domain.
 * It is configuration, not code: a new domain supplies a new profile and the
 * parser itself does not change.
 *
 * `idPrefix` is an internal knob for entity id generation (e.g. "cause" ->
 * "cause-001"). It is stripped from the public result.
 */
const CONCEPT_KEY = /^[A-Z][A-Z0-9_]*$/;
const ID_PREFIX = /^[a-z][a-z0-9-]*$/;

export const semanticConceptSchema = z
  .object({
    key: z.string().regex(CONCEPT_KEY, "concept key must be UPPER_SNAKE_CASE"),
    description: z.string().min(1),
    category: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    idPrefix: z.string().regex(ID_PREFIX).optional(),
  })
  .strict();

export const relationshipDefinitionSchema = z
  .object({
    key: z.string().regex(CONCEPT_KEY, "relationship key must be UPPER_SNAKE_CASE"),
    description: z.string().min(1),
  })
  .strict();

export const semanticProfileSchema = z
  .object({
    concepts: z.array(semanticConceptSchema).min(1),
    relationships: z.array(relationshipDefinitionSchema),
    /** Optional hints shown to the classifier. Not enforced: classification stays open-vocabulary. */
    documentTypeHints: z.array(z.string().min(1)).optional(),
    domainHints: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    const seen = new Set<string>();
    profile.concepts.forEach((concept, index) => {
      if (seen.has(concept.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["concepts", index, "key"],
          message: `duplicate concept key ${concept.key}`,
        });
      }
      seen.add(concept.key);
    });
    const seenRelationships = new Set<string>();
    profile.relationships.forEach((relationship, index) => {
      if (seenRelationships.has(relationship.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["relationships", index, "key"],
          message: `duplicate relationship key ${relationship.key}`,
        });
      }
      seenRelationships.add(relationship.key);
    });
  });

export type SemanticConcept = z.infer<typeof semanticConceptSchema>;
export type RelationshipDefinition = z.infer<typeof relationshipDefinitionSchema>;
export type SemanticProfile = z.infer<typeof semanticProfileSchema>;

export type SemanticProfileValidation =
  | { readonly ok: true; readonly profile: SemanticProfile }
  | { readonly ok: false; readonly issues: readonly string[] };

export function validateSemanticProfile(input: unknown): SemanticProfileValidation {
  const parsed = semanticProfileSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, profile: parsed.data };
  }
  return { ok: false, issues: formatZodIssues(parsed.error) };
}

/** Flattens zod issues into short `path: message` strings (bounded for prompt/log safety). */
export function formatZodIssues(error: z.ZodError, limit = 20): string[] {
  return error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${path === "" ? "(root)" : path}: ${issue.message}`;
  });
}
