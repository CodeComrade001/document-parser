
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";
import { DocumentParserPayload } from "../core/document/DocumentTypes";

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
}

type MultipartPart = MultipartFilePart | MultipartFieldPart;

interface MultipartRequest {
  parts(): AsyncIterable<MultipartPart>;
}

interface FastifyReply {
  code(statusCode: number): FastifyReply;
  send(payload: unknown): unknown;
}

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
    const payloads: DocumentParserPayload[] = [];

    try {
      for await (const part of request.parts()) {
        if (part.type !== "file" || part.fieldname !== "files") {
          continue;
        }

        const documentType = this.resolveDocumentType(
          part.filename,
          part.mimetype,
        );

        const chunks: Buffer[] = [];

        for await (const chunk of part.file) {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk),
          );
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
            message:
              `Unsupported or invalid document: ${part.filename}. ` +
              "Supported types are PDF, DOCX, and Markdown.",
          };
        }

        if (!this.hasValidSignature(buffer, documentType)) {
          return {
            success: false,
            message:
              `The file content does not match the declared format: ${part.filename}.`,
          };
        }

        const metadata: DocumentMetadata = {
          id: randomUUID(),
          name: part.filename,
          size: buffer.length,
          type: documentType,
        };

        payloads.push({
          content: buffer,
          fileName: metadata.name,
          mimeType: part.mimetype,
          file: Readable.from([buffer]),
        });
      }

      if (payloads.length === 0) {
        return {
          success: false,
          message: "No documents provided in the 'files' field.",
        };
      }

      return {
        success: true,
        data: payloads,
      };
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
