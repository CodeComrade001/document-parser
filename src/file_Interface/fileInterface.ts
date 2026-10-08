import { Readable } from "node:stream";

export type SupportedDocumentType =
  | "pdf"
  | "docx"
  | "markdown";

export interface DocumentMetadata {
  id: string;
  name: string;
  size: number;
  type: SupportedDocumentType;
  filepath?: string;
}

export interface FileUploadModel {
  metadata: DocumentMetadata;
  file: Readable;
  fileContent?: string;
}