import type { FastifyInstance } from "fastify";
import DocumentAnalysisUsecase from "../usecase/DocumentAnalysisUsecase";
import DocumentController from "../controller/DocumentController";
import { NodeLlamaCppRuntime } from "../adapters/llm/local/NodeLlamaCppRuntime";
import { resolveRelativePath } from "../shared/utils/resolveRelativePath";
import { CreateLocalDocumentParser } from "../core/createLocalDocumentParser";

export async function DocumentRoute(app: FastifyInstance): Promise<void> {

  const NODE_RUNTIME = new NodeLlamaCppRuntime({
    modelPath: resolveRelativePath("SmolLM2-1.7B-Instruct-Q2_K.gguf"),
    contextSize: 8192,
  });

  const { parser: documentParser, dispose, initialize } = await CreateLocalDocumentParser(NODE_RUNTIME);

  //lllm model testion
  initialize()

  const documentAnalyzerUsecase = new DocumentAnalysisUsecase(documentParser);
  const documentController = new DocumentController(documentAnalyzerUsecase);

  app.addHook("onClose", async () => {
    await dispose();
  });

  app.post("/upload", documentController.UploadDocumentForAnalysis.bind(documentController));
}

