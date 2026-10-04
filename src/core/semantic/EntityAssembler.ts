import type { EntitySource, ExtractedEntity } from "../document/DocumentParserResult.js";
import type { SemanticProfile } from "./SemanticProfile.js";

export interface CandidateEntity {
  readonly concept: string;
  readonly value: string;
  readonly source: EntitySource;
}

const ID_NUMBER_PAD = 3;

/** Case/whitespace/trailing-punctuation insensitive key used for de-duplication. */
export function normalizeEntityValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "").trim();
}

function defaultIdPrefix(conceptKey: string): string {
  return conceptKey.toLowerCase().replace(/_/g, "-");
}

/**
 * Merges per-chunk candidates into the final entity list.
 *  - De-duplicates on (concept, normalized value); the FIRST occurrence wins,
 *    so provenance points to the earliest place in the document.
 *  - Assigns deterministic ids ("cause-001") in document order. Concepts that
 *    share an idPrefix share one counter, so ids stay unique.
 */
export function assembleEntities(
  candidates: readonly CandidateEntity[],
  profile: SemanticProfile,
): ExtractedEntity[] {
  const prefixByConcept = new Map(
    profile.concepts.map((concept) => [concept.key, concept.idPrefix ?? defaultIdPrefix(concept.key)]),
  );
  const seen = new Set<string>();
  const counters = new Map<string, number>();
  const entities: ExtractedEntity[] = [];

  for (const candidate of candidates) {
    const dedupeKey = `${candidate.concept}\u0000${normalizeEntityValue(candidate.value)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const prefix = prefixByConcept.get(candidate.concept) ?? defaultIdPrefix(candidate.concept);
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);

    entities.push({
      id: `${prefix}-${String(next).padStart(ID_NUMBER_PAD, "0")}`,
      concept: candidate.concept,
      value: candidate.value,
      source: candidate.source,
    });
  }
  return entities;
}
