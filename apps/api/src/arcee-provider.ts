export type QaTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type QaProviderReply = {
  reply: string;
  finishReason: string | null;
  model: string;
  usage: QaTokenUsage | null;
};

export type ArceeProviderConfig = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
};

export type ArceeFailureCategory =
  | "authentication"
  | "configuration"
  | "malformed_response"
  | "network"
  | "rate_limited"
  | "timeout"
  | "unavailable";

export class ArceeProviderError extends Error {
  readonly category: ArceeFailureCategory;
  readonly retryable: boolean;

  constructor(
    category: ArceeFailureCategory,
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = "ArceeProviderError";
    this.category = category;
    this.retryable = retryable;
  }
}

const ARCEE_CHAT_URL = "https://models.arcee.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;

function tokenCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function parseUsage(value: unknown): QaTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  const inputTokens = tokenCount(raw.prompt_tokens);
  const outputTokens = tokenCount(raw.completion_tokens);
  const totalTokens =
    tokenCount(raw.total_tokens) ??
    (inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null);
  return inputTokens === null && outputTokens === null && totalTokens === null
    ? null
    : { inputTokens, outputTokens, totalTokens };
}

function responseError(status: number): ArceeProviderError {
  if (status === 401 || status === 403) {
    return new ArceeProviderError(
      "authentication",
      "The Q&A provider is not authenticated."
    );
  }
  if (status === 429) {
    return new ArceeProviderError(
      "rate_limited",
      "The Q&A provider is temporarily busy.",
      true
    );
  }
  if (status === 408 || status === 425 || status >= 500) {
    return new ArceeProviderError(
      "unavailable",
      "The Q&A provider is temporarily unavailable.",
      true
    );
  }
  return new ArceeProviderError(
    "unavailable",
    "The Q&A provider rejected the request."
  );
}

export async function askArcee(
  config: ArceeProviderConfig,
  system: string,
  messages: Array<{ role: string; content: string }>,
  fetchImpl: typeof fetch = fetch
): Promise<QaProviderReply> {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();
  if (!apiKey) {
    throw new ArceeProviderError(
      "configuration",
      "Arcee Q&A is not configured."
    );
  }
  if (!model) {
    throw new ArceeProviderError(
      "configuration",
      "The Arcee Q&A model is not configured."
    );
  }

  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  );
  const maxAttempts = Math.min(
    3,
    Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  );
  let lastError: ArceeProviderError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ARCEE_CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...messages],
          temperature: 0.7,
          max_tokens: 1200,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const failure = responseError(response.status);
        if (failure.retryable && attempt < maxAttempts) {
          lastError = failure;
          continue;
        }
        throw failure;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ArceeProviderError(
          "malformed_response",
          "The Q&A provider returned an invalid response."
        );
      }

      const parsed = data as {
        choices?: Array<{
          message?: { content?: unknown };
          finish_reason?: unknown;
        }>;
        model?: unknown;
        usage?: unknown;
      };
      const content = parsed.choices?.[0]?.message?.content;
      const reply = typeof content === "string" ? content.trim() : "";
      if (!reply) {
        throw new ArceeProviderError(
          "malformed_response",
          "The Q&A provider returned an empty response."
        );
      }

      return {
        reply,
        finishReason:
          typeof parsed.choices?.[0]?.finish_reason === "string"
            ? parsed.choices[0].finish_reason
            : null,
        model:
          typeof parsed.model === "string" && parsed.model.trim()
            ? parsed.model
            : model,
        usage: parseUsage(parsed.usage),
      };
    } catch (error) {
      if (error instanceof ArceeProviderError) {
        if (error.retryable && attempt < maxAttempts) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const failure = controller.signal.aborted
        ? new ArceeProviderError(
            "timeout",
            "The Q&A provider timed out.",
            true
          )
        : new ArceeProviderError(
            "network",
            "The Q&A provider could not be reached.",
            true
          );
      if (attempt < maxAttempts) {
        lastError = failure;
        continue;
      }
      throw failure;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new ArceeProviderError(
      "unavailable",
      "The Q&A provider is temporarily unavailable."
    )
  );
}
