import type { DocumentLimits } from "../../shared/config/DocumentParserConfig.js";
import { PayloadValidationError } from "../../shared/errors/DocumentParserErrors.js";
import {
  validateSemanticProfile,
  type SemanticProfile,
} from "../semantic/SemanticProfile.js";
import type { DocumentParserPayload } from "./DocumentTypes.js";

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_TYPE_LENGTH = 255;

export interface ValidatedPayload {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly semanticProfile?: SemanticProfile;
}

function sanitizeFileName(fileName: string): string {
  // Treat both Windows and POSIX separators as untrusted path delimiters.
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  return baseName.trim();
}

/**
 * Validates one document payload.
 *
 * The caller may pass an array of payloads, but each item must be
 * validated independently.
 *
 * This function does not parse the document or trust its declared MIME type.
 */
export function validatePayload(
  payload: DocumentParserPayload,
  limits: DocumentLimits,
): ValidatedPayload {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new PayloadValidationError("payload must be an object");
  }

  if (
    typeof limits.maxDocumentBytes !== "number" ||
    !Number.isSafeInteger(limits.maxDocumentBytes) ||
    limits.maxDocumentBytes <= 0
  ) {
    throw new Error("maxDocumentBytes must be a positive safe integer");
  }

  const { content, fileName, mimeType, semanticProfile } = payload;

  let bytes: Uint8Array;

  if (typeof content === "string") {
    bytes = new TextEncoder().encode(content);
  } else if (Buffer.isBuffer(content)) {
    // Own the bytes; do not retain a reference to the caller's Buffer.
    bytes = Uint8Array.from(content);
  } else if (content instanceof Uint8Array) {
    bytes = Uint8Array.from(content);
  } else {
    throw new PayloadValidationError(
      "payload.content must be a string or Uint8Array",
    );
  }

  if (bytes.byteLength === 0) {
    throw new PayloadValidationError("payload.content is empty");
  }

  if (bytes.byteLength > limits.maxDocumentBytes) {
    throw new PayloadValidationError(
      `document is ${bytes.byteLength} bytes, limit is ${limits.maxDocumentBytes}`,
      "PAYLOAD_TOO_LARGE",
      {
        details: {
          byteLength: bytes.byteLength,
          maxDocumentBytes: limits.maxDocumentBytes,
        },
      },
    );
  }

  const result: {
    bytes: Uint8Array;
    fileName?: string;
    mimeType?: string;
    semanticProfile?: SemanticProfile;
  } = { bytes };

  if (fileName !== undefined) {
    if (
      typeof fileName !== "string" ||
      fileName.length > MAX_FILE_NAME_LENGTH ||
      fileName.includes("\0")
    ) {
      throw new PayloadValidationError(
        "payload.fileName must be a string without NUL characters (max 255 chars)",
      );
    }

    const safeName = sanitizeFileName(fileName);

    if (safeName.length > 0) {
      result.fileName = safeName;
    }
  }

  if (mimeType !== undefined) {
    if (
      typeof mimeType !== "string" ||
      mimeType.length > MAX_MIME_TYPE_LENGTH ||
      mimeType.includes("\0")
    ) {
      throw new PayloadValidationError(
        "payload.mimeType must be a string without NUL characters (max 255 chars)",
      );
    }

    result.mimeType = mimeType.trim().toLowerCase();
  }

  if (semanticProfile !== undefined) {
    const validation = validateSemanticProfile(semanticProfile);

    if (!validation.ok) {
      throw new PayloadValidationError(
        `payload.semanticProfile is invalid: ${validation.issues.join("; ")}`,
      );
    }

    result.semanticProfile = validation.profile;
  }

  return result;
}