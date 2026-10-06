import { access } from "node:fs/promises";
import type { Llama, LlamaModel } from "node-llama-cpp";
import { ConfigurationError } from "../../../shared/errors/DocumentParserErrors.js";
import type { LocalLLMCompletion, LocalLLMCompletionInput, LocalLLMRuntime } from "./LocalLLMProvider.js";
import { resolveRelativePath } from "../../../shared/utils/resolveRelativePath.js";

export interface NodeLlamaCppRuntimeOptions {
  /** Absolute or cwd-relative path to the .gguf file, e.g. "./model/SmolLM2-1.7B-Instruct-Q2_K.gguf". */
  readonly modelPath: string;
  /**
   * Context window in tokens (prompt + output must fit). SmolLM2 supports ~8k.
   * Keep chunk size and llm.maxOutputTokens small enough to fit (see example).
   */
  readonly contextSize?: number;
}

const DEFAULT_CONTEXT_SIZE = 8192;

interface LoadedModel {
  readonly llama: Llama;
  readonly model: LlamaModel;
}

/**
 * LocalLLMRuntime backed by node-llama-cpp (llama.cpp bindings, runs GGUF models
 * inside the Node process).
 *
 *  - The model is loaded lazily on first use and then kept in memory.
 *  - Calls are serialised: one local model, one generation at a time.
 *  - Output is constrained by llama.cpp's JSON grammar, so it is always
 *    syntactically valid JSON. The parser still validates the SHAPE with zod.
 *  - node-llama-cpp is imported lazily, so applications that only use a remote
 *    provider do not need it installed.
 */
export class NodeLlamaCppRuntime implements LocalLLMRuntime {
  private loading: Promise<LoadedModel> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: NodeLlamaCppRuntimeOptions) { }

  public complete(input: LocalLLMCompletionInput): Promise<LocalLLMCompletion> {
    const run = this.queue.then(() => this.generate(input));
    // Keep the chain alive after failures so one bad call does not block later ones.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Frees the model. Call on application shutdown. */
  public async dispose(): Promise<void> {
    const loading = this.loading;
    this.loading = undefined;
    if (loading !== undefined) {
      const { model } = await loading;
      await model.dispose();
    }
  }

  private async generate(input: LocalLLMCompletionInput): Promise<LocalLLMCompletion> {
    const { LlamaChatSession } = await import("node-llama-cpp");
    const { llama, model } = await this.load();
    const grammar = await llama.getGrammarFor("json");
    const context = await model.createContext({ contextSize: this.options.contextSize ?? DEFAULT_CONTEXT_SIZE });
    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: input.system,
      });
      const text = await session.prompt(input.prompt, {
        grammar,
        signal: input.signal,
        ...(input.maxOutputTokens === undefined ? {} : { maxTokens: input.maxOutputTokens }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      });
      return {
        text,
        inputTokens: model.tokenize(input.system + input.prompt).length,
        outputTokens: model.tokenize(text).length,
      };
    } finally {
      await context.dispose(); // frees the KV cache; the model stays loaded
    }
  }

  private load(): Promise<LoadedModel> {
    this.loading ??= this.loadModel().catch((error: unknown) => {
      this.loading = undefined; // allow a later retry instead of caching the failure
      throw error;
    });
    return this.loading;
  }

  private async loadModel(): Promise<LoadedModel> {
    try {
      await access(this.options.modelPath);
    } catch (error) {
      throw new ConfigurationError(`local model file not found or unreadable: ${this.options.modelPath}`, { cause: error });
    }
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: this.options.modelPath });
    return { llama, model };
  }
}




