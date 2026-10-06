import { createLLMProvider } from "../adapters/llm/LLMProviderFactory.js";
import { NODE_RUNTIME } from "../route/document.routes.js";
import { incidentReportProfile } from "../shared/config/profiles/incidentReport.profile.js";
import { DocumentParserConstructor } from "./DocumentParserConstructor.js";

export function createLocalDocumentParser() {
  const parser = new DocumentParserConstructor({
    llmProvider: createLLMProvider({
      provider: "local",
      model: "SmolLM2-1.7B-Instruct-Q2_K",
      runtime: NODE_RUNTIME,
      timeoutMs: 5 * 60_000,
    }),
    semanticProfile: incidentReportProfile,
    config: {
      limits: { maxChunkChars: 3000, minChunkChars: 1000 },
      llm: { maxOutputTokens: 1024, chunkConcurrency: 1 },
    },
  });

  return { parser, dispose: () => NODE_RUNTIME.dispose() };
}