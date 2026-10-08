import { Readable } from "node:stream";

import { FileUploadModel } from "../file_Interface/fileInterface";
import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";

type SupportedDocumentType = "pdf" | "docx" | "markdown";

interface DocumentMetadata {
  id: string;
  name: string;
  size: number;
  type: SupportedDocumentType;
  filepath?: string;
}

interface DocumentUploadResult {
  success: true;
  data: FileUploadModel[];
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
  file: Readable & {
    bytesRead?: number;
  };
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

      const payload = await this.documentAnalysisUsecase.execute(
        uploadResult.data,
      );

      return reply.code(200).send({
        success: true,
        // jobId: payload?.jobId ?? "",
        data: payload,
      });
    } catch (error) {
      console.error(
        "Document analysis request failed:",
        error,
      );

      return reply.code(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  }

  private async fileToStream(
    request: MultipartRequest,
  ): Promise<DocumentUploadResponse> {
    try {
      const files: FileUploadModel[] = [];

      let requestMetadata: Partial<DocumentMetadata> = {};

      for await (const part of request.parts()) {
        if (
          part.type === "field" &&
          part.fieldname === "metadata"
        ) {
          if (
            typeof part.value !== "string" ||
            !part.value.trim()
          ) {
            continue;
          }

          try {
            requestMetadata = JSON.parse(part.value);
          } catch {
            return {
              success: false,
              message: "Invalid metadata payload",
            };
          }

          continue;
        }

        if (
          part.type !== "file" ||
          part.fieldname !== "files"
        ) {
          continue;
        }

        const documentType = this.resolveDocumentType(
          part.filename,
        );

        if (!documentType) {
          return {
            success: false,
            message:
              "Unsupported document type. Supported types are PDF, DOCX, and Markdown.",
          };
        }

        files.push({
          metadata: {
            id:
              typeof requestMetadata.id === "string" &&
                requestMetadata.id.trim()
                ? requestMetadata.id
                : crypto.randomUUID(),

            name: part.filename,

            size:
              typeof part.file.bytesRead === "number"
                ? part.file.bytesRead
                : 0,

            type: documentType,

            filepath:
              typeof requestMetadata.filepath === "string"
                ? requestMetadata.filepath
                : undefined,
          },

          file: part.file,
        });
      }

      if (!files.length) {
        return {
          success: false,
          message: "No documents provided",
        };
      }

      return {
        success: true,
        data: files,
      };
    } catch (error) {
      console.error(
        "Error while processing document upload:",
        error,
      );

      return {
        success: false,
        message: "Failed to process uploaded document",
      };
    }
  }

  private resolveDocumentType(
    filename: string,
  ): SupportedDocumentType | null {
    const extension = filename
      .toLowerCase()
      .substring(filename.lastIndexOf("."));

    switch (extension) {
      case ".pdf":
        return "pdf";

      case ".docx":
        return "docx";

      case ".md":
      case ".markdown":
        return "markdown";

      default:
        return null;
    }
  }
}