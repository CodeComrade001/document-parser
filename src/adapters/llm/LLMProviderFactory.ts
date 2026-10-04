import type { LLMProvider } from "../../core/llm/LLMProvider.js";
import { GoogleLLMProvider } from "./google/GoogleLLMProvider.js";
import { LocalLLMProvider, type LocalLLMRuntime } from "./local/LocalLLMProvider.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export type LLMProviderSettings =
  | {
      readonly provider: "google";
      readonly model: string;
      readonly apiKey: string;
      readonly timeoutMs?: number;
      readonly endpointBase?: string;
    }
  | {
      readonly provider: "local";
      readonly model: string;
      readonly runtime: LocalLLMRuntime;
      readonly timeoutMs?: number;
    };

/**
 * Convenience factory. Adding a provider = add a union member and a branch.
 * Applications may skip this and pass any LLMProvider straight to the bootstrap.
 *
 * TODO(manual): fold into the existing adapters/llm/provider-registry.ts if you
 * prefer a single registry (its contents were not visible when this was written),
 * and map LLM_PROVIDER / LLM_MODEL / GOOGLE_API_KEY / LLM_ENDPOINT env vars to
 * these settings.
 */
export function createLLMProvider(settings: LLMProviderSettings): LLMProvider {
  const timeoutMs = settings.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  switch (settings.provider) {
    case "google":
      return new GoogleLLMProvider({
        apiKey: settings.apiKey,
        model: settings.model,
        timeoutMs,
        ...(settings.endpointBase === undefined ? {} : { endpointBase: settings.endpointBase }),
      });
    case "local":
      return new LocalLLMProvider(settings.runtime, { model: settings.model, timeoutMs });
  }
}
