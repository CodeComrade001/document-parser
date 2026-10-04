import type { DocumentLimits } from "../../shared/config/DocumentParserConfig.js";
import { PayloadValidationError } from "../../shared/errors/DocumentParserErrors.js";
import { validateSemanticProfile, type SemanticProfile } from "../semantic/SemanticProfile.js";

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_TYPE_LENGTH = 255;

export interface ValidatedPayload {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly semanticProfile?: SemanticProfile;
}

/** Strips any directory component; the result is only ever used for its extension. */
function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  return base.trim();
}

/**
 * Validates untrusted caller input. Does not inspect document structure -
 * that is format detection's job.
 */
export function validatePayload(payload: unknown, limits: DocumentLimits): ValidatedPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new PayloadValidationError("payload must be an object");
  }
  const candidate = payload as Record<string, unknown>;
  const { content, fileName, mimeType, semanticProfile } = candidate;

  let bytes: Uint8Array;
  if (typeof content === "string") {
    bytes = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    bytes = content;
  } else {
    throw new PayloadValidationError("payload.content must be a string or Uint8Array");
  }
  if (bytes.byteLength === 0) {
    throw new PayloadValidationError("payload.content is empty");
  }
  if (bytes.byteLength > limits.maxDocumentBytes) {
    throw new PayloadValidationError(
      `document is ${bytes.byteLength} bytes, limit is ${limits.maxDocumentBytes}`,
      "PAYLOAD_TOO_LARGE",
      { details: { byteLength: bytes.byteLength, maxDocumentBytes: limits.maxDocumentBytes } },
    );
  }

  const result: {
    bytes: Uint8Array;
    fileName?: string;
    mimeType?: string;
    semanticProfile?: SemanticProfile;
  } = { bytes };

  if (fileName !== undefined) {
    if (typeof fileName !== "string" || fileName.length > MAX_FILE_NAME_LENGTH || fileName.includes("\0")) {
      throw new PayloadValidationError("payload.fileName must be a string without NUL characters (max 255 chars)");
    }
    const safeName = sanitizeFileName(fileName);
    if (safeName !== "") {
      result.fileName = safeName;
    }
  }

  if (mimeType !== undefined) {
    if (typeof mimeType !== "string" || mimeType.length > MAX_MIME_TYPE_LENGTH) {
      throw new PayloadValidationError("payload.mimeType must be a string (max 255 chars)");
    }
    result.mimeType = mimeType;
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
