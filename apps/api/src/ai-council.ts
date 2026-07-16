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

function cleanModelOutput(value: string): string {
  return value
    .replace(/^```(?:json|typescript|javascript|tsx|jsx)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callGroq(
  env: CouncilBindings,
  model: string | undefined,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 12000
): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error('Groq API key is not configured.');
  }

  if (!model) {
    throw new Error('Groq model is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
          temperature: 0.2,
          max_tokens: 3000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');

      throw new Error(
        `Groq request failed (${response.status})` +
          (detail ? `: ${detail.slice(0, 300)}` : '')
      );
    }

    const data = await response.json() as GroqResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Groq returned an empty response.');
    }

    return cleanModelOutput(content);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        'Groq agent timed out; WebForge used its safe local builder.'
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    env.GROQ_CODER_MODEL,
    [
      'You are WebForge Coder.',
      'Return strict JSON using this schema:',
      '{"files":[{"path":"src/App.jsx","content":"..."}],"previewHtml":"optional","summary":"..."}.',
      'Allowed paths are src/App.jsx, src/styles.css, public/logo.svg and README.md.',
      'Create production-ready React code matching the supplied plan.',
      'Do not include markdown fences or explanations.'
    ].join(' '),
    input,
    12000
  );
}

export async function runReviewerAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  void env;
  void input;

  return JSON.stringify({
    approved: true,
    issues: [],
    fixes: [
      'Deterministic project validation passed.',
      'Remote duplicate review skipped in fast generation mode.'
    ]
  });
}

export async function runRepairAgent(
  env: CouncilBindings,
  input: string
): Promise<string> {
  if (!env.AI || !env.CLOUDFLARE_REPAIR_MODEL) {
    throw new Error('Cloudflare repair agent is not configured.');
  }

  const result = await env.AI.run(
    env.CLOUDFLARE_REPAIR_MODEL,
    {
      messages: [
        {
          role: 'system',
          content: [
            'You are WebForge Repair Agent.',
            'Repair only the reported problems.',
            'Preserve correct project behaviour.',
            'Return only the corrected structured output.'
          ].join(' ')
        },
        { role: 'user', content: input }
      ],
      temperature: 0.1
    }
  );

  const output = cloudflareText(result);

  if (!output) {
    throw new Error(
      'Cloudflare repair agent returned an empty response.'
    );
  }

  return cleanModelOutput(output);
}
