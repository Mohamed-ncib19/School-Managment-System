import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamEvent {
  type: "content" | "reasoning" | "done" | "error";
  content?: string;
}

export type AiProvider = "endpoint" | "self-hosted";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly fallbackClient: OpenAI;
  private readonly selfHostedClient: OpenAI;
  private readonly model = "nvidia/nemotron-3-ultra-550b-a55b";
  private readonly fallbackModel = "openai/gpt-oss-20b";
  private readonly selfHostedModel = "openai/gpt-oss-20b";

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey:
        this.config.get<string>("NVIDIA_API_KEY") ||
        "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",
    });
    this.fallbackClient = new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey:
        this.config.get<string>("NVIDIA_FALLBACK_API_KEY") ||
        "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",
    });
    // Self-hosted NVIDIA NIM: docker run ... -p 8000:8000 nvcr.io/nim/openai/gpt-oss-20b
    this.selfHostedClient = new OpenAI({
      baseURL:
        this.config.get<string>("AI_SELF_HOSTED_URL") ||
        "http://localhost:8000/v1",
      apiKey: "not-needed",
    });
  }

  private buildSystemPrompt(): string {
    return `You are the AI assistant for IQ Academy, a school management system. You chat naturally with the manager in their language — Arabic, French, Tunisian Arabic or English. Match the user's language.

You know IQ Academy and how the system works: students, professors, groups, levels, fields, payments, invoicing and payroll. Explain features, guide the user, and answer questions about how the system works. You do not have live access to the school's data, so for real numbers you should point the user to the relevant page in the app (Dashboard, Payments, Students, Professors...).

## Rules
- Greetings, small talk and thanks: just chat warmly and briefly.
- Be concise but informative.
- Never invent numbers or data about the school.`;
  }

  /** Retries on NVIDIA quota exhaustion (free-tier "request limit reached"). */
  private static readonly RATE_LIMIT_RETRIES = 3;
  private static readonly RATE_LIMIT_BASE_DELAY_MS = 3000;

  private isRateLimit(error: unknown): boolean {
    const err = error as { status?: number; message?: string };
    return (
      err?.status === 429 ||
      (typeof err?.message === "string" &&
        /resourceexhausted|request limit|rate limit/i.test(err.message))
    );
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  private async createOnce(
    client: OpenAI,
    model: string,
    apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return client.chat.completions.create(
      {
        model,
        messages: apiMessages,
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 16384,
        stream: true,
      },
      { signal },
    );
  }

  /**
   * Primary model first; when its quota is exhausted (free-tier request
   * limits), fall back to the second key + lighter gpt-oss-20b model.
   */
  private async createStream(
    apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    signal?: AbortSignal,
  ) {
    for (let attempt = 0; attempt <= AiService.RATE_LIMIT_RETRIES; attempt++) {
      try {
        return await this.createOnce(this.client, this.model, apiMessages, signal);
      } catch (error) {
        if (!this.isRateLimit(error)) throw error;
        if (attempt < AiService.RATE_LIMIT_RETRIES) {
          const wait = AiService.RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
          this.logger.warn(
            `AI rate limit hit, retrying in ${wait}ms (attempt ${attempt + 1}/${AiService.RATE_LIMIT_RETRIES})`,
          );
          await this.sleep(wait, signal);
        }
      }
    }
    // Primary exhausted its quota — switch to the fallback key + model.
    this.logger.warn(
      `Primary model quota exhausted, falling back to ${this.fallbackModel}`,
    );
    return this.createOnce(
      this.fallbackClient,
      this.fallbackModel,
      apiMessages,
      signal,
    );
  }

  /**
   * Plain streaming chat with the LLM — no tools, no database access.
   * provider "endpoint" uses the NVIDIA cloud API (with key fallback),
   * provider "self-hosted" uses the local NIM container on :8000.
   */
  async *chatStream(
    messages: ChatMessage[],
    signal?: AbortSignal,
    provider: AiProvider = "endpoint",
  ): AsyncGenerator<StreamEvent> {
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.buildSystemPrompt() },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      this.logger.log(
        `Chat with ${messages.length} messages via ${provider}`,
      );

      const stream =
        provider === "self-hosted"
          ? await this.createOnce(
              this.selfHostedClient,
              this.selfHostedModel,
              apiMessages,
              signal,
            )
          : await this.createStream(apiMessages, signal);

      for await (const chunk of stream) {
        if (signal?.aborted) return;
        if (!chunk.choices || !chunk.choices.length) continue;

        const delta = chunk.choices[0].delta;

        const reasoning = (delta as any).reasoning_content;
        if (reasoning) {
          yield { type: "reasoning", content: reasoning };
        }

        if (delta.content) {
          yield { type: "content", content: delta.content };
        }
      }

      yield { type: "done" };
    } catch (error) {
      // Client disconnected / generation stopped — end silently.
      if (signal?.aborted) return;
      this.logger.error("AI chat error", (error as Error).stack);
      if (this.isRateLimit(error)) {
        yield {
          type: "error",
          content:
            "The AI service quota is exhausted right now. Wait a minute and try again.",
        };
      } else if (
        provider === "self-hosted" &&
        /ECONNREFUSED|fetch failed|ENOTFOUND|Failed to fetch/i.test(
          (error as Error).message,
        )
      ) {
        yield {
          type: "error",
          content:
            "The self-hosted AI is not running. Start the Docker container (port 8000) and try again.",
        };
      } else {
        yield { type: "error", content: (error as Error).message };
      }
    }
  }
}
