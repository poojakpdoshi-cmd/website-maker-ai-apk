export type CouncilBindings = {
  GROQ_API_KEY?: string;
  GROQ_CODER_MODEL?: string;
  GROQ_REVIEWER_MODEL?: string;
  CLOUDFLARE_REPAIR_MODEL?: string;
  AI?: {
    run: (
      model: string,
      input: Record<string, unknown>
    ) => Promise<unknown>;
  };
};

type GroqResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type RemoteAgentFailureCode =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'network'
  | 'empty_response';

export class RemoteAgentError extends Error {
  readonly stage: string;
  readonly code: RemoteAgentFailureCode;
  readonly retryable: boolean;
  readonly attempt: number;

  constructor(
    stage: string,
    code: RemoteAgentFailureCode,
    message: string,
    retryable: boolean,
    attempt: number
  ) {
    super(message);
    this.name = 'RemoteAgentError';
    this.stage = stage;
    this.code = code;
    this.retryable = retryable;
    this.attempt = attempt;
  }
}

function cleanModelOutput(value: string): string {
  return value
    .replace(/^```(?:json|typescript|javascript|tsx|jsx)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function waitForRetry(attempt: number): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(1200, 250 * 2 ** attempt))
  );
}

async function callGroq(
  env: CouncilBindings,
  stage: string,
  model: string | undefined,
  systemPrompt: string,
  userPrompt: string,
  options: {
    timeoutMs: number;
    maxTokens: number;
    temperature?: number;
    maxAttempts?: number;
  }
): Promise<string> {
  if (!env.GROQ_API_KEY || !model) {
    throw new RemoteAgentError(
      stage,
      'not_configured',
      `${stage} is not configured.`,
      false,
      0
    );
  }

  const maxAttempts = Math.max(1, Math.min(3, options.maxAttempts || 2));
  let lastError: RemoteAgentError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(`${stage}_timeout`),
      options.timeoutMs
    );
    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${env.GROQ_API_KEY}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model,
            temperature: options.temperature ?? 0.15,
            max_tokens: options.maxTokens,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ]
          })
        }
      );

      if (!response.ok) {
        const code: RemoteAgentFailureCode = response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'provider_5xx'
            : 'provider_4xx';
        const retryable = response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw new RemoteAgentError(
          stage,
          code,
          `${stage} provider returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts}).`,
          retryable,
          attempt
        );
      }

      const data = await response.json() as GroqResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new RemoteAgentError(
          stage,
          'empty_response',
          `${stage} returned an empty response (attempt ${attempt}/${maxAttempts}).`,
          attempt < maxAttempts,
          attempt
        );
      }
      return cleanModelOutput(content);
    } catch (error) {
      if (error instanceof RemoteAgentError) {
        lastError = error;
      } else if (controller.signal.aborted) {
        lastError = new RemoteAgentError(
          stage,
          'timeout',
          `${stage} timed out after ${options.timeoutMs}ms (attempt ${attempt}/${maxAttempts}).`,
          true,
          attempt
        );
      } else {
        lastError = new RemoteAgentError(
          stage,
          'network',
          `${stage} could not reach its provider (attempt ${attempt}/${maxAttempts}).`,
          true,
          attempt
        );
      }

      if (!lastError.retryable || attempt >= maxAttempts) throw lastError;
      await waitForRetry(attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new RemoteAgentError(
    stage,
    'network',
    `${stage} failed.`,
    false,
    maxAttempts
  );
}

function cloudflareText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const record = result as Record<string, unknown>;
  if (typeof record.response === 'string') return record.response;
  if (typeof record.result === 'string') return record.result;
  if (record.result && typeof record.result === 'object') {
    const nested = record.result as Record<string, unknown>;
    if (typeof nested.response === 'string') return nested.response;
  }
  return '';
}

export async function runCodingAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  return callGroq(
    env,
    'coder',
    env.GROQ_CODER_MODEL,
    [
      'You are Nexora.Ai Coder.',
      'The supplied appSpec is binding and every requirement must be implemented.',
      'Return strict JSON: {"files":[{"path":"src/App.jsx","content":"complete file"}],"previewHtml":"complete standalone preview","summary":"..."}.',
      'Return complete replacement src/App.jsx and src/styles.css files, never snippets.',
      'Additional frontend files may be placed under src/components, src/features, src/hooks, src/lib, src/pages, src/services or src/utils.',
      'Backend/API, schema, migration, environment example and README files are allowed when required.',
      'For non-marketing applications do not generate a hero, pricing, testimonials, FAQ or SaaS dashboard unless appSpec requires it.',
      'Every visible button must perform its named action.',
      'Do not include markdown fences, placeholder success states or decorative controls.'
    ].join(' '),
    input,
    {
      timeoutMs: 60000,
      maxTokens: 12000,
      maxAttempts: 2,
      temperature: 0.12
    }
  );
}

export async function runThinkMaxPlanningAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  return callGroq(
    env,
    'thinkmax_planner',
    env.GROQ_CODER_MODEL,
    [
      'You are Nexora ThinkMax Architecture Reviewer.',
      'Refine the supplied plan without losing any appSpec requirement.',
      'Return strict JSON with exactly refinedPlan, architectureBrief and reviewSummary.',
      'refinedPlan must preserve the full WebsitePlan shape including binding appSpec.',
      'Do not include private reasoning, markdown fences or extra keys.'
    ].join(' '),
    input,
    {
      timeoutMs: 60000,
      maxTokens: 8192,
      maxAttempts: 2,
      temperature: 0.1
    }
  );
}

export async function runReviewerAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  return callGroq(
    env,
    'reviewer',
    env.GROQ_REVIEWER_MODEL,
    [
      'You are Nexora.Ai Requirement Reviewer.',
      'Compare the generated files against every item in the binding appSpec.',
      'Reject missing columns, fields, formulas, screens, relationships, persistence, real-time dependencies, mobile behavior or acceptance requirements.',
      'Reject decorative CRUD, search, sorting, modal, export and navigation controls.',
      'Reject a marketing page when a functional application was requested.',
      'Return strict JSON only: {"approved":boolean,"issues":string[],"fixes":string[]}.',
      'Approve only when no blocking requirement is missing.'
    ].join(' '),
    input,
    {
      timeoutMs: 45000,
      maxTokens: 5000,
      maxAttempts: 2,
      temperature: 0
    }
  );
}

export async function runRepairAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  if (!env.AI || !env.CLOUDFLARE_REPAIR_MODEL) {
    throw new RemoteAgentError(
      'repair',
      'not_configured',
      'Repair agent is not configured.',
      false,
      0
    );
  }

  let lastError: RemoteAgentError | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RemoteAgentError(
          'repair',
          'timeout',
          `Repair agent timed out after 60000ms (attempt ${attempt}/2).`,
          true,
          attempt
        )), 60000);
      });
      const runPromise = env.AI.run(env.CLOUDFLARE_REPAIR_MODEL, {
        messages: [
          {
            role: 'system',
            content: [
              'You are Nexora.Ai Repair Agent.',
              'The appSpec is binding.',
              'Return strict JSON with complete corrected files.',
              'Fix every reported requirement without breaking working behavior.',
              'Do not return markdown or private reasoning.'
            ].join(' ')
          },
          { role: 'user', content: input }
        ],
        temperature: 0.05,
        max_tokens: 10000
      });
      const result = await Promise.race([runPromise, timeoutPromise]);
      const output = cloudflareText(result);
      if (!output) {
        throw new RemoteAgentError(
          'repair',
          'empty_response',
          `Repair agent returned an empty response (attempt ${attempt}/2).`,
          true,
          attempt
        );
      }
      return cleanModelOutput(output);
    } catch (error) {
      lastError = error instanceof RemoteAgentError
        ? error
        : new RemoteAgentError(
            'repair',
            'network',
            `Repair agent failed (attempt ${attempt}/2).`,
            true,
            attempt
          );
      if (!lastError.retryable || attempt >= 2) throw lastError;
      await waitForRetry(attempt);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  throw lastError!;
}
