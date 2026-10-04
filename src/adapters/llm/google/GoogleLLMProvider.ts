import { z } from "zod";
import type { LLMProvider, LLMRequest, LLMResponse, LLMUsage } from "../../../core/llm/LLMProvider.js";
import { ConfigurationError, LLMProviderError } from "../../../shared/errors/DocumentParserErrors.js";

const PROVIDER_NAME = "google";
const DEFAULT_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

export interface GoogleLLMProviderOptions {
  /**
   * TODO(manual): supply from your secret store / environment (GOOGLE_API_KEY).
   * Never hardcode or log it. It is only ever sent as a request header.
   */
  readonly apiKey: string;
  /** TODO(manual): choose the model (LLM_MODEL), e.g. a Gemini model id. */
  readonly model: string;
  readonly timeoutMs: number;
  /** Must be https. Override only for a proxy or regional endpoint. */
  readonly endpointBase?: string;
  /** Injectable for tests. Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

const generateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() })
    .optional(),
});

/** Google Generative Language REST adapter (generateContent). */
export class GoogleLLMProvider implements LLMProvider {
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;

  public constructor(private readonly options: GoogleLLMProviderOptions) {
    if (options.apiKey.trim() === "") throw new ConfigurationError("Google API key is not configured");
    if (options.model.trim() === "") throw new ConfigurationError("Google model is not configured");
    const base = (options.endpointBase ?? DEFAULT_ENDPOINT_BASE).replace(/\/+$/, "");
    if (!base.startsWith("https://")) throw new ConfigurationError("Google endpoint must use https");
    this.endpoint = `${base}/models/${encodeURIComponent(options.model)}:generateContent`;
    this.fetchFn = options.fetch ?? fetch;
  }

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    const startedAt = Date.now();
    let httpResponse: Response;
    try {
      httpResponse = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
          },
        }),
      });
    } catch (error) {
      // Network failure or timeout: transient by nature.
      throw new LLMProviderError(PROVIDER_NAME, "request to Google failed (network or timeout)", true, { cause: error });
    }

    if (!httpResponse.ok) {
      const retryable = httpResponse.status === HTTP_TOO_MANY_REQUESTS || httpResponse.status >= HTTP_SERVER_ERROR_MIN;
      throw new LLMProviderError(PROVIDER_NAME, `Google returned HTTP ${httpResponse.status}`, retryable, {
        details: { status: httpResponse.status },
      });
    }

    let body: unknown;
    try {
      body = await httpResponse.json();
    } catch (error) {
      throw new LLMProviderError(PROVIDER_NAME, "Google returned a non-JSON response body", false, { cause: error });
    }
    const parsed = generateContentResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new LLMProviderError(PROVIDER_NAME, "Google response had an unexpected shape", false, { cause: parsed.error });
    }

    const candidate = parsed.data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (candidate === undefined || text === "") {
      const reason = parsed.data.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no content";
      throw new LLMProviderError(PROVIDER_NAME, `Google returned no content (${reason})`, false);
    }

    const meta = parsed.data.usageMetadata;
    const usage: LLMUsage = {
      ...(meta?.promptTokenCount === undefined ? {} : { inputTokens: meta.promptTokenCount }),
      ...(meta?.candidatesTokenCount === undefined ? {} : { outputTokens: meta.candidatesTokenCount }),
    };
    return {
      text,
      provider: PROVIDER_NAME,
      model: this.options.model,
      latencyMs: Date.now() - startedAt,
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    };
  }
}
