import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NexoraTokenError,
  finalizeNexoraTokens,
  getNexoraOperationCost,
  refundNexoraTokens,
  reserveNexoraTokens
} from './subscription-tokens';
import {
  buildNexoraSystemPrompt,
  chooseNexoraRoute,
  type NexoraMode,
  type NexoraRoutePlan
} from './nexora-system-prompt';

type AssistantEnv = {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  NEXORA_X0_MODEL?: string;
  NEXORA_Y1_MODEL?: string;
  NEXORA_N1_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_CODER_MODEL?: string;
  AI?: {
    run: (
      model: string,
      input: Record<string, unknown>
    ) => Promise<unknown>;
  };
  CLOUDFLARE_REPAIR_MODEL?: string;
};

type ChatTurn = {
  role: 'assistant' | 'user';
  text: string;
};

type ProviderTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type NexoraSource = {
  title: string;
  url: string;
};

type ProviderReply = {
  reply: string;
  usage: ProviderTokenUsage | null;
  sources: NexoraSource[];
};

const requestWindows = new Map<
  string,
  { startedAt: number; count: number }
>();

function checkRateLimit(key: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 20;
  const existing = requestWindows.get(key);

  if (!existing || now - existing.startedAt >= windowMs) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return { allowed: true };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowMs - (now - existing.startedAt)) / 1000)
      )
    };
  }

  existing.count += 1;
  return { allowed: true };
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function providerUsage(
  inputValue: unknown,
  outputValue: unknown,
  totalValue: unknown
): ProviderTokenUsage | null {
  const inputTokens = tokenCount(inputValue);
  const outputTokens = tokenCount(outputValue);
  const providerTotal = tokenCount(totalValue);
  const totalTokens = providerTotal ?? (
    inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null
  );

  if (
    inputTokens === null &&
    outputTokens === null &&
    totalTokens === null
  ) {
    return null;
  }

  return { inputTokens, outputTokens, totalTokens };
}

function cleanUsername(value: unknown): string {
  const raw =
    typeof value === 'string'
      ? value.trim().split(/[\s@._-]+/)[0]
      : '';

  if (!raw) return 'there';
  return raw.charAt(0).toUpperCase() + raw.slice(1, 30);
}

function isNexoraIdentityQuestion(value: string): boolean {
  const text = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /\bwho (?:has )?(?:made|created|developed|designed|owns?) (?:you|nexora(?: ai)?)\b/.test(text) ||
    /\bwho is your (?:creator|owner|developer|designer)\b/.test(text) ||
    /\bwho is (?:the )?(?:creator|owner|developer|designer) of nexora(?: ai)?\b/.test(text) ||
    /\b(?:creator|owner|developer|designer) of nexora(?: ai)?\b/.test(text)
  );
}

function historyMessages(
  history: unknown,
  message: string
): Array<{ role: string; content: string }> {
  const safeHistory =
    Array.isArray(history)
      ? history
          .slice(-16)
          .filter(
            (item): item is ChatTurn =>
              Boolean(
                item &&
                typeof item === 'object' &&
                (item.role === 'user' || item.role === 'assistant') &&
                typeof item.text === 'string'
              )
          )
          .map((item) => ({
            role: item.role,
            content: item.text.slice(0, 5000)
          }))
      : [];

  return [
    ...safeHistory,
    { role: 'user', content: message }
  ];
}

function geminiModel(
  env: AssistantEnv,
  mode: NexoraMode
): string {
  const configured =
    mode === 'x0-ultra'
      ? env.NEXORA_X0_MODEL || env.GEMINI_MODEL
      : mode === 'y1'
        ? env.NEXORA_Y1_MODEL
        : env.NEXORA_N1_MODEL;

  const fallback =
    mode === 'x0-ultra'
      ? 'gemini-3.1-pro-preview'
      : mode === 'y1'
        ? 'gemini-3.6-flash'
        : 'gemini-3.5-flash-lite';

  return (configured || fallback).replace(/^models\//, '');
}

function uniqueSources(values: NexoraSource[]): NexoraSource[] {
  const seen = new Set<string>();

  return values.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 8);
}

async function askGemini(
  env: AssistantEnv,
  system: string,
  messages: Array<{ role: string; content: string }>,
  route: NexoraRoutePlan
): Promise<ProviderReply> {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Gemini is not configured.');
  }

  const model = geminiModel(env, route.mode);
  const requestBody: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: system }]
    },
    contents: messages.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }]
    })),
    generationConfig: {
      temperature: route.mode === 'n1' ? 0.45 : 0.3,
      maxOutputTokens: route.maxOutputTokens
    }
  };

  if (route.useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Gemini ${model} failed with status ${response.status}: ${detail}`
    );
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string; thought?: boolean }>;
      };
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const candidate = data.candidates?.[0];
  const output = candidate?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text || '')
    .join('')
    .trim();

  if (!output) {
    throw new Error('Gemini returned an empty reply.');
  }

  const sources = uniqueSources(
    candidate?.groundingMetadata?.groundingChunks
      ?.map((chunk) => ({
        title: chunk.web?.title?.trim() || 'Source',
        url: chunk.web?.uri?.trim() || ''
      })) || []
  );

  return {
    reply: output,
    usage: providerUsage(
      data.usageMetadata?.promptTokenCount,
      data.usageMetadata?.candidatesTokenCount,
      data.usageMetadata?.totalTokenCount
    ),
    sources
  };
}

async function askGroq(
  env: AssistantEnv,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1800
): Promise<ProviderReply> {
  if (!env.GROQ_API_KEY) {
    throw new Error('Groq is not configured.');
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model:
          env.GROQ_CODER_MODEL ||
          'llama-3.3-70b-versatile',
        temperature: 0.3,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          ...messages
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Groq failed with status ${response.status}.`
    );
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: { content?: string };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const output =
    data.choices?.[0]?.message?.content?.trim();

  if (!output) {
    throw new Error('Groq returned an empty reply.');
  }

  return {
    reply: output,
    usage: providerUsage(
      data.usage?.prompt_tokens,
      data.usage?.completion_tokens,
      data.usage?.total_tokens
    ),
    sources: []
  };
}

async function askCloudflare(
  env: AssistantEnv,
  system: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1500
): Promise<ProviderReply> {
  if (!env.AI) {
    throw new Error('Cloudflare AI is not configured.');
  }

  const result = await env.AI.run(
    env.CLOUDFLARE_REPAIR_MODEL ||
      '@cf/meta/llama-3.1-8b-instruct',
    {
      messages: [
        { role: 'system', content: system },
        ...messages
      ],
      max_tokens: maxTokens,
      temperature: 0.3
    }
  ) as {
    response?: string;
    result?: { response?: string };
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const output = (
    result.response ||
    result.result?.response ||
    ''
  ).trim();

  if (!output) {
    throw new Error('Cloudflare AI returned an empty reply.');
  }

  return {
    reply: output,
    usage: providerUsage(
      result.usage?.prompt_tokens,
      result.usage?.completion_tokens,
      result.usage?.total_tokens
    ),
    sources: []
  };
}

async function runX0Critic(
  env: AssistantEnv,
  originalMessage: string,
  draft: string
): Promise<string> {
  const criticSystem = [
    'You are the Nexora X0 Ultra critic and repair specialist.',
    'Review the draft for factual errors, missing requirements, contradictions, unsafe guidance, weak architecture and unclear writing.',
    'Return a corrected final answer only.',
    'Preserve truthful uncertainty.',
    'Do not invent sources, actions, tests or deployment results.',
    'Do not mention this review process.'
  ].join(' ');

  const criticMessages = [{
    role: 'user',
    content:
      `Original request:\n${originalMessage.slice(0, 7000)}` +
      `\n\nDraft answer:\n${draft.slice(0, 14000)}`
  }];

  try {
    if (env.NEXORA_Y1_MODEL || env.GEMINI_API_KEY) {
      return (await askGemini(
        env,
        criticSystem,
        criticMessages,
        {
          mode: 'y1',
          useSearch: false,
          maxOutputTokens: 2600,
          runCritic: false
        }
      )).reply;
    }

    if (env.GROQ_API_KEY) {
      return (await askGroq(
        env,
        criticSystem,
        criticMessages,
        2600
      )).reply;
    }
  } catch {
    // Keep the primary response if the independent critic is unavailable.
  }

  return draft;
}

function appendSources(
  reply: string,
  sources: NexoraSource[]
): string {
  if (!sources.length) return reply;

  const lines = sources.map(
    (source, index) =>
      `${index + 1}. ${source.title} — ${source.url}`
  );

  return `${reply}\n\nSources:\n${lines.join('\n')}`;
}

export function registerAssistantChatRoutes(
  app: { post: (...args: any[]) => unknown },
  deps: {
    requireUser: (
      c: any,
      email: string,
      installationId?: string
    ) => Promise<any>;
    requireSupabase: (env: any) => SupabaseClient;
  }
): void {
  app.post('/assistant/chat', async (c: any) => {
    const authorization =
      c.req.header('authorization') || '';

    if (!authorization.startsWith('Bearer ')) {
      return c.json({ error: 'Authentication required.' }, 401);
    }

    const body = await c.req
      .json()
      .catch(() => ({})) as {
        message?: unknown;
        username?: unknown;
        history?: unknown;
        email?: unknown;
        installationId?: unknown;
        attachment?: unknown;
        mode?: unknown;
      };

    const attachment =
      body.attachment &&
      typeof body.attachment === 'object'
        ? body.attachment as {
            name?: unknown;
            dataUrl?: unknown;
          }
        : null;

    let attachmentText = '';

    if (
      attachment &&
      typeof attachment.name === 'string' &&
      typeof attachment.dataUrl === 'string'
    ) {
      const match = attachment.dataUrl.match(
        /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s
      );
      const textual =
        match &&
        /^(text\/|application\/(json|xml|javascript|x-javascript|csv))/.test(
          match[1]
        );

      if (match && textual) {
        try {
          attachmentText = decodeURIComponent(
            Array.from(
              atob(match[2]),
              (char) =>
                `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
            ).join('')
          ).slice(0, 24_000);
        } catch {
          attachmentText = '';
        }
      }
    }

    const baseMessage =
      typeof body.message === 'string'
        ? body.message.trim().slice(0, 12_000)
        : '';

    const message = attachmentText
      ? `${baseMessage}\n\nUploaded file: ${String(
          attachment?.name || 'document'
        )}\n\n${attachmentText}`
      : baseMessage;

    if (!message) {
      return c.json({ error: 'Message is required.' }, 400);
    }

    const email =
      typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';
    const installationId =
      typeof body.installationId === 'string'
        ? body.installationId.slice(0, 200)
        : '';

    if (!email || !installationId) {
      return c.json(
        { error: 'Account identity is required.' },
        400
      );
    }

    const rate = checkRateLimit(`${email}:${installationId}`);

    if (!rate.allowed) {
      return c.json(
        {
          error: 'Too many requests. Please wait briefly.',
          retryAfterSeconds: rate.retryAfterSeconds
        },
        429
      );
    }

    const access = await deps.requireUser(
      c,
      email,
      installationId
    );

    if (!access) {
      return c.json(
        { error: 'Your login session is missing or expired.' },
        401
      );
    }

    if (!access.ok) {
      return c.json({ error: access.error }, access.status);
    }

    const route = chooseNexoraRoute(body.mode, message);

    if (isNexoraIdentityQuestion(message)) {
      return c.json({
        reply:
          'Nexora.AI was created, designed, developed and is owned by Poojak Doshi.',
        provider: 'nexora-identity',
        mode: route.mode,
        researched: false,
        reviewed: false,
        sources: [],
        processingDurationMs: 0,
        usage: null
      });
    }

    const supabase = deps.requireSupabase(c.env);
    let chatReservationId: string | null = null;

    try {
      const defaultCost =
        route.mode === 'x0-ultra'
          ? 8
          : route.mode === 'y1'
            ? 5
            : 3;

      const chatCost = await getNexoraOperationCost(
        supabase,
        'assistant_chat',
        defaultCost
      );

      chatReservationId = (await reserveNexoraTokens(
        supabase,
        email,
        chatCost,
        'assistant_chat',
        crypto.randomUUID(),
        `AI chat message (${route.mode})`
      )).reservationId;
    } catch (tokenError) {
      return c.json(
        {
          error:
            tokenError instanceof Error
              ? tokenError.message
              : 'Could not reserve Nexora Tokens.'
        },
        (
          tokenError instanceof NexoraTokenError
            ? tokenError.status
            : 500
        ) as any
      );
    }

    const username = cleanUsername(body.username);
    const system = buildNexoraSystemPrompt(username, route);
    const messages = historyMessages(body.history, message);
    const errors: string[] = [];
    const processingStartedAt = Date.now();

    const providers: Array<[
      string,
      () => Promise<ProviderReply>
    ]> =
      route.mode === 'n1'
        ? [
            [
              'groq',
              () => askGroq(
                c.env,
                system,
                messages,
                route.maxOutputTokens
              )
            ],
            [
              'gemini',
              () => askGemini(c.env, system, messages, route)
            ],
            [
              'cloudflare',
              () => askCloudflare(
                c.env,
                system,
                messages,
                route.maxOutputTokens
              )
            ]
          ]
        : [
            [
              'gemini',
              () => askGemini(c.env, system, messages, route)
            ],
            [
              'groq',
              () => askGroq(
                c.env,
                system,
                messages,
                route.maxOutputTokens
              )
            ],
            [
              'cloudflare',
              () => askCloudflare(
                c.env,
                system,
                messages,
                route.maxOutputTokens
              )
            ]
          ];

    for (const [providerName, execute] of providers) {
      try {
        const primary = await execute();
        const reviewedReply = route.runCritic
          ? await runX0Critic(c.env, message, primary.reply)
          : primary.reply;
        const finalReply = appendSources(
          reviewedReply,
          primary.sources
        );

        await finalizeNexoraTokens(
          supabase,
          chatReservationId
        );

        return c.json({
          reply: finalReply,
          provider: providerName,
          mode: route.mode,
          researched: route.useSearch && primary.sources.length > 0,
          reviewed: route.runCritic,
          sources: primary.sources,
          processingDurationMs: Math.max(
            0,
            Date.now() - processingStartedAt
          ),
          usage: primary.usage
        });
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `${providerName}: ${error.message}`
            : `${providerName} failed.`
        );
      }
    }

    await refundNexoraTokens(
      supabase,
      chatReservationId,
      errors.join(' | ') || 'All AI providers failed'
    );

    return c.json(
      {
        error:
          'All Nexora OmniRoute providers are temporarily unavailable.',
        mode: route.mode,
        providerErrors: errors
      },
      503
    );
  });
}
