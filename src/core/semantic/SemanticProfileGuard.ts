import {
  formatZodIssues,
  validateSemanticProfile,
  type SemanticProfile,
  type SemanticProfileValidation,
} from "./SemanticProfile";

/**
 * Abuse guard for semantic profiles.
 *
 * A profile is user-supplied text that ends up inside LLM prompts. The base
 * schema checks shape; this guard bounds size and rejects text that tries to
 * smuggle instructions into the prompt. It layers on top of
 * validateSemanticProfile() and never replaces it.
 */

export const SEMANTIC_PROFILE_LIMITS = {
  /** Raw request field size, checked BEFORE JSON.parse. */
  maxRawBytes: 32 * 1024,
  /** Serialized size of the validated profile. */
  maxSerializedBytes: 16 * 1024,
  maxConcepts: 40,
  maxRelationships: 40,
  maxAliasesPerConcept: 10,
  maxHintsPerList: 10,
  maxKeyLength: 64,
  maxIdPrefixLength: 24,
  maxCategoryLength: 48,
  maxDescriptionLength: 300,
  maxAliasLength: 60,
  maxHintLength: 80,
  minGenerationDescriptionLength: 20,
  maxGenerationDescriptionLength: 2000,
} as const;

const L = SEMANTIC_PROFILE_LIMITS;

/** Control chars, zero-width chars, bidi overrides, BOM. Also covers newlines. */
const FORBIDDEN_CHARACTERS =
  /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;

/**
 * Heuristic detection of instruction-like text. This is defense in depth, not
 * a security boundary: paraphrases will get through. The real protection is
 * size limits, single-line text, and rendering the profile in the prompt as
 * delimited DATA.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+.{0,40}\b(?:instructions?|rules?|prompt)/i,
  /\b(?:reveal|print|show|leak|output|return|send)\b.{0,40}\b(?:system\s+prompt|api[\s_-]?keys?|secrets?|credentials?|passwords?|environment\s+variables?|tokens?)/i,
  /\b(?:system|assistant|developer)\s*:/i,
  /<\|.*?\|>/,
  /<\/?\s*[a-z][a-z0-9_-]*(?:\s[^>]*)?>/i, // tag-like markup that could forge prompt delimiters
  /```/,
  /\byou\s+(?:are|must|will|should)\s+now\b/i,
  /\b(?:act|behave|pretend)\s+(?:as|like)\b/i,
  /\b(?:new|updated|override)\s+instructions?\b/i,
  /https?:\/\//i, // profiles describe concepts; they never need URLs
];

export function looksLikeInstruction(text: string): boolean {
  // NFKC folds full-width and compatibility forms (e.g. "ｉｇｎｏｒｅ") before matching.
  const normalized = text.normalize("NFKC");
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function inspectText(
  issues: string[],
  path: string,
  value: string,
  maxLength: number,
): void {
  if (value.length > maxLength) {
    issues.push(`${path}: must be at most ${maxLength} characters`);
    return;
  }
  if (FORBIDDEN_CHARACTERS.test(value)) {
    issues.push(`${path}: must be a single line without control or invisible characters`);
    return;
  }
  if (looksLikeInstruction(value)) {
    issues.push(`${path}: contains instruction-like or markup text, which is not allowed`);
  }
}

function capIssues(issues: string[]): readonly string[] {
  return issues.slice(0, 20);
}

/**
 * Validates the schema (via the existing validator), then enforces limits and
 * text safety. Returns the same shape as validateSemanticProfile().
 */
export function guardSemanticProfile(input: unknown): SemanticProfileValidation {
  const base = validateSemanticProfile(input);
  if (!base.ok) {
    return base;
  }

  const profile = base.profile;
  const issues: string[] = [];

  if (profile.concepts.length > L.maxConcepts) {
    issues.push(`concepts: at most ${L.maxConcepts} allowed`);
  }
  if (profile.relationships.length > L.maxRelationships) {
    issues.push(`relationships: at most ${L.maxRelationships} allowed`);
  }

  profile.concepts.forEach((concept, i) => {
    const p = `concepts.${i}`;
    inspectText(issues, `${p}.key`, concept.key, L.maxKeyLength);
    inspectText(issues, `${p}.description`, concept.description, L.maxDescriptionLength);
    inspectText(issues, `${p}.category`, concept.category, L.maxCategoryLength);
    if (concept.idPrefix !== undefined) {
      inspectText(issues, `${p}.idPrefix`, concept.idPrefix, L.maxIdPrefixLength);
    }
    if (concept.aliases.length > L.maxAliasesPerConcept) {
      issues.push(`${p}.aliases: at most ${L.maxAliasesPerConcept} allowed`);
    }
    concept.aliases.forEach((alias, a) =>
      inspectText(issues, `${p}.aliases.${a}`, alias, L.maxAliasLength),
    );
  });

  profile.relationships.forEach((relationship, i) => {
    const p = `relationships.${i}`;
    inspectText(issues, `${p}.key`, relationship.key, L.maxKeyLength);
    inspectText(issues, `${p}.description`, relationship.description, L.maxDescriptionLength);
  });

  for (const field of ["documentTypeHints", "domainHints"] as const) {
    const hints = profile[field];
    if (!hints) continue;
    if (hints.length > L.maxHintsPerList) {
      issues.push(`${field}: at most ${L.maxHintsPerList} allowed`);
    }
    hints.forEach((hint, h) => inspectText(issues, `${field}.${h}`, hint, L.maxHintLength));
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(profile), "utf8");
  if (serializedBytes > L.maxSerializedBytes) {
    issues.push(`(root): profile is ${serializedBytes} bytes; the limit is ${L.maxSerializedBytes}`);
  }

  return issues.length > 0
    ? { ok: false, issues: capIssues(issues) }
    : { ok: true, profile };
}

/**
 * For the multipart `semanticProfile` field: bounds raw size first, then
 * parses, then runs the full guard. Never throws for bad input.
 */
export function parseSemanticProfileField(raw: string): SemanticProfileValidation {
  const rawBytes = Buffer.byteLength(raw, "utf8");
  if (rawBytes > L.maxRawBytes) {
    return {
      ok: false,
      issues: [`(root): semanticProfile is ${rawBytes} bytes; the limit is ${L.maxRawBytes}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, issues: ["(root): semanticProfile is not valid JSON"] };
  }

  return guardSemanticProfile(parsed);
}

export type GenerationDescriptionValidation =
  | { readonly ok: true; readonly description: string }
  | { readonly ok: false; readonly issues: readonly string[] };

/** For POST /documents/profiles/generate request bodies. */
export function guardGenerationDescription(input: unknown): GenerationDescriptionValidation {
  if (typeof input !== "string") {
    return { ok: false, issues: ["description: must be a string"] };
  }

  const description = input.trim();
  const issues: string[] = [];

  if (description.length < L.minGenerationDescriptionLength) {
    issues.push(`description: must be at least ${L.minGenerationDescriptionLength} characters`);
  }
  if (description.length > L.maxGenerationDescriptionLength) {
    issues.push(`description: must be at most ${L.maxGenerationDescriptionLength} characters`);
  }
  // Newlines are allowed in a free-text description; other control and invisible characters are not.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(description)) {
    issues.push("description: contains control or invisible characters");
  }
  if (looksLikeInstruction(description)) {
    issues.push("description: contains instruction-like or markup text. Describe the documents and entities instead");
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, description };
}

export { formatZodIssues, type SemanticProfile, type SemanticProfileValidation };