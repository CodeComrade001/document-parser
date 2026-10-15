import { createLLMProvider } from "../adapters/llm/LLMProviderFactory.js";
import { NodeLlamaCppRuntime } from "../adapters/llm/local/NodeLlamaCppRuntime.js";
import { incidentReportProfile } from "../shared/config/profiles/incidentReport.profile.js";
import { DocumentParserConstructor } from "./DocumentParserConstructor.js";

export async function CreateLocalDocumentParser(nodeRuntime: NodeLlamaCppRuntime) {
  const parser = new DocumentParserConstructor({
    llmProvider: createLLMProvider({
      provider: "local",
      model: "SmolLM2-1.7B-Instruct-Q2_K",
      runtime: nodeRuntime,
      timeoutMs: 5 * 60_000,
    }),
    semanticProfile: incidentReportProfile,
    config: {
      limits: { maxChunkChars: 3000, minChunkChars: 1000 },
      llm: {
        maxOutputTokens: 2048,
        chunkConcurrency: 1,
      },
    },
  });

  return {
    parser,
    initialize: () => nodeRuntime.initialize(),
    dispose: () => nodeRuntime.dispose()
  };
}


