import type { LLMProvider, LLMRequest, LLMResponse, LLMUsage } from "../../../core/llm/LLMProvider.js";
import { LLMProviderError } from "../../../shared/errors/DocumentParserErrors.js";
import { NodeLlamaCppRuntime } from "./NodeLlamaCppRuntime.js";

export interface LocalLLMCompletionInput {
  readonly system: string;
  readonly prompt: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** The runtime should constrain output to JSON if it supports grammar/JSON mode. */
  readonly jsonOutput: true;
  /** Aborted when the provider timeout elapses. Runtimes should honour it. */
  readonly signal: AbortSignal;
}

export interface LocalLLMCompletion {
  readonly text: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * Port to whatever in-process or sidecar runtime hosts the local model.
 *
 * TODO(manual): implement this against your chosen runtime (llama.cpp binding,
 * Transformers.js, an inference sidecar, ...), including model selection,
 * loading, and endpoint/config. The parser core and LocalLLMProvider know
 * nothing about which runtime is used.
 *
 * Throw LLMProviderError(provider, msg, retryable) for failures whose
 * retryability you know; any other error is treated as non-retryable.
 */
export interface LocalLLMRuntime {
  complete(input: LocalLLMCompletionInput): Promise<LocalLLMCompletion>;
}

export interface LocalLLMProviderOptions {
  readonly model: string;
  readonly timeoutMs: number;
}

const PROVIDER_NAME = "local";

/** Adds timeout, error normalisation and response shaping around a LocalLLMRuntime. */
export class LocalLLMProvider implements LLMProvider {
  public constructor(
    private readonly runtime: LocalLLMRuntime,
    private readonly options: LocalLLMProviderOptions,
  ) { }

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LLMProviderError(PROVIDER_NAME, `local model did not respond within ${this.options.timeoutMs}ms`, true));
      }, this.options.timeoutMs);
    });

    try {
      const completion = await Promise.race([
        this.runtime.complete({
          system: request.system,
          prompt: request.prompt,
          jsonOutput: true,
          signal: controller.signal,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
        }),
        timeout,
      ]);
      console.log("Turbo Log  ~ LocalLLMProvider ~ generate ~ completion.text:", completion.text);

      const usage: LLMUsage = {
        ...(completion.inputTokens === undefined ? {} : { inputTokens: completion.inputTokens }),
        ...(completion.outputTokens === undefined ? {} : { outputTokens: completion.outputTokens }),
      };
      return {
        text: completion.text,
        provider: PROVIDER_NAME,
        model: this.options.model,
        latencyMs: Date.now() - startedAt,
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
      };
    } catch (error) {
      if (error instanceof LLMProviderError) throw error;
      throw new LLMProviderError(PROVIDER_NAME, "local model runtime failed", false, { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
