import { Readable } from "node:stream";

import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";
import { DocumentParserPayload } from "../core/document/DocumentTypes";
import { SemanticProfile } from "../core/semantic/SemanticProfile";
import { parseSemanticProfileField } from "../core/semantic/SemanticProfileGuard";

type SupportedDocumentType = "pdf" | "docx" | "markdown";

interface DocumentMetadata {
  id: string;
  name: string;
  size: number;
  type: SupportedDocumentType;
}

interface DocumentUploadResult {
  success: true;
  data: DocumentParserPayload[];
}

interface DocumentUploadFailure {
  success: false;
  message: string;
  /** Per-field validation details, present for semantic profile failures. */
  issues?: readonly string[];
}

type DocumentUploadResponse =
  | DocumentUploadResult
  | DocumentUploadFailure;

interface MultipartFilePart {
  type: "file";
  fieldname: string;
  filename: string;
  mimetype: string;
  file: Readable;
}

interface MultipartFieldPart {
  type: "field";
  fieldname: string;
  value: unknown;
  /** Set by the multipart plugin when the value exceeded the configured field size limit. */
  valueTruncated?: boolean;
}

type MultipartPart = MultipartFilePart | MultipartFieldPart;

interface MultipartRequest {
  parts(): AsyncIterable<MultipartPart>;
}

interface FastifyReply {
  code(statusCode: number): FastifyReply;
  send(payload: unknown): unknown;
}

const SEMANTIC_PROFILE_FIELD = "semanticProfile";
const FILES_FIELD = "files";

export default class DocumentController {
  constructor(
    private readonly documentAnalysisUsecase: DocumentAnalysisUsecase,
  ) { }

  public async UploadDocumentForAnalysis(
    request: MultipartRequest,
    reply: FastifyReply,
  ) {
    try {
      const uploadResult = await this.fileToStream(request);

      if (!uploadResult.success) {
        return reply.code(400).send({
          success: false,
          message: uploadResult.message,
          ...(uploadResult.issues ? { issues: uploadResult.issues } : {}),
        });
      }

      const result = await this.documentAnalysisUsecase.execute(
        uploadResult.data,
      );

      if (!result.success) {
        return reply.code(422).send(result);
      }

      return reply.code(200).send({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      console.error("Document analysis request failed:", error);

      return reply.code(500).send({
        success: false,
        message: "Failed to analyze the uploaded documents.",
      });
    }
  }

  private async fileToStream(
    request: MultipartRequest,
  ): Promise<DocumentUploadResponse> {
    const uploads: Omit<DocumentParserPayload, "semanticProfile">[] = [];

    // Validated as soon as the field arrives, applied after the loop so
    // multipart field order does not matter.
    let semanticProfile: SemanticProfile | undefined;
    let semanticProfileSeen = false;

    try {
      for await (const part of request.parts()) {
        if (part.type === "field") {
          if (part.fieldname !== SEMANTIC_PROFILE_FIELD) {
            continue;
          }

          if (semanticProfileSeen) {
            return {
              success: false,
              message: "Only one semanticProfile field is allowed.",
            };
          }
          semanticProfileSeen = true;

          // The multipart plugin truncates oversized fields instead of failing.
          if (part.valueTruncated || typeof part.value !== "string") {
            return {
              success: false,
              message: "Invalid semantic profile: the field is too large or not text.",
            };
          }

          const result = parseSemanticProfileField(part.value);
          if (!result.ok) {
            return {
              success: false,
              message: "Invalid semantic profile.",
              issues: result.issues,
            };
          }

          semanticProfile = result.profile;
          continue;
        }

        if (part.fieldname !== FILES_FIELD) {
          continue;
        }

        const documentType = this.resolveDocumentType(part.filename, part.mimetype);

        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) {
          return {
            success: false,
            message: `The uploaded file is empty: ${part.filename}`,
          };
        }

        if (!documentType) {
          return {
            success: false,
            message: `Unsupported document: ${part.filename}.`,
          };
        }

        if (!this.hasValidSignature(buffer, documentType)) {
          return {
            success: false,
            message: `File content does not match its declared format: ${part.filename}.`,
          };
        }

        uploads.push({
          content: buffer,
          fileName: part.filename,
          mimeType: part.mimetype,
          file: Readable.from([buffer]),
        });
      }

      if (uploads.length === 0) {
        return {
          success: false,
          message: "No documents provided in the 'files' field.",
        };
      }

      const payloads: DocumentParserPayload[] = uploads.map((upload) => ({
        ...upload,
        semanticProfile,
      }));

      return { success: true, data: payloads };
    } catch (error) {
      console.error("Error processing document upload:", error);

      return {
        success: false,
        message: "Failed to process uploaded documents.",
      };
    }
  }

  private resolveDocumentType(
    filename: string,
    mimeType: string,
  ): SupportedDocumentType | null {
    const extension = filename.toLowerCase().split(".").pop();

    switch (extension) {
      case "pdf":
        return "pdf";

      case "docx":
        return "docx";

      case "md":
      case "markdown":
        return "markdown";

      default:
        switch (mimeType.toLowerCase()) {
          case "application/pdf":
            return "pdf";

          case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return "docx";

          case "text/markdown":
          case "text/x-markdown":
            return "markdown";

          default:
            return null;
        }
    }
  }

  private hasValidSignature(
    buffer: Buffer,
    type: SupportedDocumentType,
  ): boolean {
    switch (type) {
      case "pdf":
        return buffer.subarray(0, 5).toString("ascii") === "%PDF-";

      case "docx":
        return (
          buffer.length >= 4 &&
          buffer[0] === 0x50 &&
          buffer[1] === 0x4b &&
          (
            (buffer[2] === 0x03 && buffer[3] === 0x04) ||
            (buffer[2] === 0x05 && buffer[3] === 0x06) ||
            (buffer[2] === 0x07 && buffer[3] === 0x08)
          )
        );

      case "markdown":
        return !buffer.includes(0x00);
    }
  }
}