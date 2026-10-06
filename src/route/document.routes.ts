import type { FastifyInstance } from "fastify";
import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";
import DocumentController from "../controller/DocumentController";
import { DocumentParserConstructor } from "../core/DocumentParserConstructor";
import { LocalLLMProvider } from "../adapters/llm/local/LocalLLMProvider";
import { NodeLlamaCppRuntime } from "../adapters/llm/local/NodeLlamaCppRuntime";
import { incidentReportProfile } from "../shared/config/profiles/incidentReport.profile";
import { resolveRelativePath } from "../shared/utils/resolveRelativePath";
import { createLocalDocumentParser } from "../core/createLocalDocumentParser";

export async function DocumentRoute(app: FastifyInstance): Promise<void> {

  const { parser: documentParser , dispose } = createLocalDocumentParser();

  const documentAnalyzerUsecase = new DocumentAnalysisUsecase(documentParser);
  const documentController = new DocumentController(documentAnalyzerUsecase);

  app.addHook("onClose", async () => {
    await dispose();
  });

  app.post("/upload", documentController.UploadDocumentForAnalysis.bind(documentController));
}


/**
 * @description Passing all the way down to the runtime, which is a singleton in this file. The runtime is shared by all requests and is disposed on server shutdown.
 * 
 */

export const NODE_RUNTIME = new NodeLlamaCppRuntime({
  modelPath: resolveRelativePath("SmolLM2-1.7B-Instruct-Q2_K.gguf"),
  contextSize: 8192,
});