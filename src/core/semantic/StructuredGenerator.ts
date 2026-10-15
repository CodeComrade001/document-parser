import type { z } from "zod";
import type { LLMProvider, LLMRequest, LLMResponse } from "../llm/LLMProvider.js";
import {
  LLMOutputValidationError,
  LLMProviderError,
} from "../../shared/errors/DocumentParserErrors.js";
import type { Logger } from "../../shared/logger/Logger.js";
import { formatZodIssues } from "./SemanticProfile.js";
import type { SemanticPromptBuilder } from "./SemanticPrompts.js";

export interface GenerationPolicy {
  readonly maxRepairAttempts: number;
  readonly maxTransportRetries: number;
  readonly retryBaseDelayMs: number;
}

export interface GenerationTrace {
  readonly operation: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  /** Total provider calls that returned a response. */
  readonly calls: number;
  readonly repairs: number;
  readonly transportRetries: number;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface StructuredGenerationResult<T> {
  readonly value: T;
  readonly trace: GenerationTrace;
}

export type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type JsonParse = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Extracts a JSON value from model text. Accepts a bare object, a fenced
 * block, or an object surrounded by prose (first "{" to last "}").
 * This only locates JSON; the content is still schema-validated afterwards.
 */
export function parseJsonLoosely(text: string): JsonParse {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidates = [fenced?.[1] ?? trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  let lastError = "response is empty";
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch (error) {
      lastError = `response is not valid JSON (${error instanceof Error ? error.message : "parse error"})`;
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Runs one LLM operation to a schema-valid result.
 *
 *   call -> parse JSON -> schema validate
 *     valid   -> return
 *     invalid -> repair request (bounded) -> validate again -> fail loudly
 *
 * Two independent, bounded retry budgets:
 *   - transport retries: provider says the failure is retryable (429/5xx/timeout)
 *   - repair attempts:   the model answered, but with invalid output
 * Neither loop can run forever.
 */
export class StructuredGenerator {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly prompts: SemanticPromptBuilder,
    private readonly policy: GenerationPolicy,
    private readonly logger: Logger,
    private readonly sleep: Sleep = defaultSleep,
  ) { }

  public async generate<T>(
    original: LLMRequest,
    schema: z.ZodType<T>,
  ): Promise<StructuredGenerationResult<T>> {
    const operation = original.metadata?.operation ?? "unknown";
    const promptVersion = original.metadata?.promptVersion ?? "unknown";
    const counters = { calls: 0, repairs: 0, transportRetries: 0, latencyMs: 0, input: 0, output: 0 };
    let request = original;
    let lastErrors: string[] = [];
    let last: LLMResponse | undefined;

    for (; ;) {
      const response = await this.callWithRetry(request, counters);
      console.log("Turbo Log  ~ StructuredGenerator ~ generate ~ response:", response);

      last = response;
      counters.calls += 1;
      counters.latencyMs += response.latencyMs;
      counters.input += response.usage?.inputTokens ?? 0;
      counters.output += response.usage?.outputTokens ?? 0;

      const json = parseJsonLoosely(response.text);
      console.log("Turbo Log  ~ StructuredGenerator ~ generate ~ json:", json);

      if (json.ok) {
        const validated = schema.safeParse(json.value);
        if (validated.success) {
          const trace = this.buildTrace(operation, promptVersion, response, counters);
          this.logger.info("llm.generate.completed", { ...trace, validation: "valid" });
          return { value: validated.data, trace };
        }
        lastErrors = formatZodIssues(validated.error);
      } else {
        lastErrors = [json.error];
      }

      if (counters.repairs >= this.policy.maxRepairAttempts) {
        break;
      }
      counters.repairs += 1;
      this.logger.warn("llm.generate.repair", {
        operation,
        promptVersion,
        repairAttempt: counters.repairs,
        errorCount: lastErrors.length,
      });
      request = this.prompts.buildRepair(original, response.text, lastErrors);
    }

    const trace = this.buildTrace(operation, promptVersion, last, counters);
    console.log("Turbo Log  ~ StructuredGenerator ~ generate ~ trace:", trace);

    this.logger.error("llm.generate.failed", { ...trace, validation: "invalid" });
    throw new LLMOutputValidationError(
      `LLM output for "${operation}" failed schema validation after ${counters.repairs} repair attempt(s)`,
      { details: { operation, promptVersion, errors: lastErrors } },
    );
  }

  private async callWithRetry(
    request: LLMRequest,
    counters: { transportRetries: number },
  ): Promise<LLMResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const providerGenerator = await this.provider.generate(request);
        console.log("Turbo Log  ~ StructuredGenerator ~ callWithRetry ~ providerGenerator:", providerGenerator);

        return providerGenerator;
      } catch (error) {
        const providerError =
          error instanceof LLMProviderError
            ? error
            : new LLMProviderError("unknown", "LLM provider threw an unexpected error", false, { cause: error });
        if (!providerError.retryable || attempt >= this.policy.maxTransportRetries) {
          throw providerError;
        }
        counters.transportRetries += 1;
        const delayMs = this.policy.retryBaseDelayMs * 2 ** attempt;
        this.logger.warn("llm.generate.retry", {
          provider: providerError.provider,
          attempt: attempt + 1,
          delayMs,
          reason: providerError.message,
        });
        await this.sleep(delayMs);
      }
    }
  }

  private buildTrace(
    operation: string,
    promptVersion: string,
    response: LLMResponse | undefined,
    counters: { calls: number; repairs: number; transportRetries: number; latencyMs: number; input: number; output: number },
  ): GenerationTrace {
    return {
      operation,
      promptVersion,
      provider: response?.provider ?? "unknown",
      model: response?.model ?? "unknown",
      calls: counters.calls,
      repairs: counters.repairs,
      transportRetries: counters.transportRetries,
      latencyMs: counters.latencyMs,
      ...(counters.input > 0 ? { inputTokens: counters.input } : {}),
      ...(counters.output > 0 ? { outputTokens: counters.output } : {}),
    };
  }
}
