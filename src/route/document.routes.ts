import type { FastifyInstance } from "fastify";
import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";
import DocumentController from "../controller/DocumentController";

export async function DocumentRoute(
  app: FastifyInstance
): Promise<void> {
  const documentAnalyzerUsecase = new DocumentAnalysisUsecase()
  const documrntController = new DocumentController(documentAnalyzerUsecase)

  app.post("/upload", documrntController.UploadDocumentForAnalysis.bind(documrntController));
}