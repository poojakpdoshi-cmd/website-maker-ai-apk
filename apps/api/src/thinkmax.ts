import { z } from 'zod';
import type { WebsitePlan } from '@wmai/shared';

export const thinkMaxFlagSchema = z.boolean().optional();

const websitePlanSchema = z.object({
  businessName: z.string().trim().min(1).max(60),
  websiteType: z.string().trim().regex(/^[a-z0-9-]+$/).max(40),
  tagline: z.string().trim().min(1).max(180),
  pages: z.array(
    z.string().trim().regex(/^[a-z0-9-]+$/).max(60)
  ).min(1).max(10),
  features: z.array(
    z.string().trim().regex(/^[a-z0-9-]+$/).max(80)
  ).max(16),
  theme: z.object({
    style: z.string().trim().min(1).max(60),
    primary: z.string().regex(/^#[0-9a-f]{6}$/i),
    secondary: z.string().regex(/^#[0-9a-f]{6}$/i),
    background: z.string().regex(/^#[0-9a-f]{6}$/i),
    text: z.string().regex(/^#[0-9a-f]{6}$/i)
  }).strict(),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(90),
    body: z.string().trim().min(1).max(520)
  }).strict()).min(4).max(7),
  contact: z.object({
    phone: z.string().trim().min(1).max(40).optional(),
    email: z.string().trim().email().max(160).optional(),
    address: z.string().trim().min(1).max(180).optional()
  }).strict().optional()
}).strict();

const thinkMaxRefinementSchema = z.object({
  refinedPlan: websitePlanSchema,
  architectureBrief: z.string().trim().min(40).max(4000),
  reviewSummary: z.string().trim().min(20).max(1000)
}).strict();

export type ThinkMaxRefinement = z.infer<
  typeof thinkMaxRefinementSchema
>;

type ThinkMaxInput = {
  request: string;
  plan: WebsitePlan;
};

type ThinkMaxRunner = (input: string) => Promise<string>;

function extractJson(value: string): unknown {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('ThinkMax output did not contain JSON.');
  }

  return JSON.parse(value.slice(start, end + 1));
}

export function parseThinkMaxRefinement(
  value: string
): ThinkMaxRefinement {
  return thinkMaxRefinementSchema.parse(extractJson(value));
}

export async function runOptionalThinkMax(
  enabled: boolean,
  input: ThinkMaxInput,
  runner: ThinkMaxRunner
): Promise<{
  plan: WebsitePlan;
  architectureBrief: string;
  completed: boolean;
}> {
  if (!enabled) {
    return {
      plan: input.plan,
      architectureBrief: '',
      completed: false
    };
  }

  try {
    const raw = await runner(JSON.stringify({
      request: input.request,
      initialPlan: input.plan
    }));
    const refinement = parseThinkMaxRefinement(raw);

    return {
      plan: {
        ...refinement.refinedPlan,
        contact: input.plan.contact
      },
      architectureBrief: refinement.architectureBrief,
      completed: true
    };
  } catch (error) {
    console.warn(
      "ThinkMax refinement failed; continuing with the standard plan:",
      error instanceof Error ? error.message : error
    );

    return {
      plan: input.plan,
      architectureBrief: "",
      completed: false
    };
  }
}
