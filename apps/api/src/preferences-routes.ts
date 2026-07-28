import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

type Deps = {
  authenticatedEmail: (c: any) => Promise<string | null>;
  requireSupabase: (env: any) => SupabaseClient;
};

const accents = {
  "nexora-cyan": "#06b6d4",
  violet: "#8b5cf6",
  blue: "#2563eb",
  emerald: "#059669",
  rose: "#e11d48",
  gold: "#b7791f",
} as const;

const preferenceSchema = z.object({
  appearanceMode: z.enum(["system", "light", "dark"]),
  accentPreset: z.enum([
    "nexora-cyan",
    "violet",
    "blue",
    "emerald",
    "rose",
    "gold",
    "custom",
  ]),
  customAccent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
});

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(left: string, right: string): number {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort(
    (a, b) => b - a
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function appearanceResponse(record?: Record<string, any> | null) {
  const preset =
    record?.accent_preset &&
    (record.accent_preset in accents || record.accent_preset === "custom")
      ? String(record.accent_preset)
      : "nexora-cyan";
  const custom =
    typeof record?.custom_accent === "string" ? record.custom_accent : null;
  const accent =
    preset === "custom" && custom
      ? custom
      : accents[preset as keyof typeof accents] || accents["nexora-cyan"];
  const whiteContrast = contrastRatio(accent, "#ffffff");
  const blackContrast = contrastRatio(accent, "#000000");
  return {
    appearanceMode: ["system", "light", "dark"].includes(
      record?.appearance_mode
    )
      ? record?.appearance_mode
      : "system",
    accentPreset: preset,
    customAccent: custom,
    resolvedAccent: accent,
    contrastText: whiteContrast >= blackContrast ? "#ffffff" : "#000000",
    contrastRatio: Math.max(whiteContrast, blackContrast),
  };
}

export function registerPreferenceRoutes(
  app: {
    get: (...args: any[]) => unknown;
    patch: (...args: any[]) => unknown;
  },
  deps: Deps
): void {
  app.get("/preferences/appearance", async (c: any) => {
    const email = await deps.authenticatedEmail(c);
    if (!email) {
      return c.json(
        { error: "Your login session is missing or expired." },
        401
      );
    }
    const { data, error } = await deps
      .requireSupabase(c.env)
      .from("user_preferences")
      .select("appearance_mode,accent_preset,custom_accent")
      .eq("owner_email", email)
      .maybeSingle();
    if (error)
      return c.json({ error: "Could not load appearance settings." }, 500);
    return c.json({ appearance: appearanceResponse(data) });
  });

  app.patch("/preferences/appearance", async (c: any) => {
    const email = await deps.authenticatedEmail(c);
    if (!email) {
      return c.json(
        { error: "Your login session is missing or expired." },
        401
      );
    }
    const parsed = preferenceSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) {
      return c.json(
        { error: "Valid appearance and accent settings are required." },
        400
      );
    }
    if (parsed.data.accentPreset === "custom" && !parsed.data.customAccent) {
      return c.json({ error: "Choose a valid custom accent colour." }, 400);
    }
    const candidate = appearanceResponse({
      appearance_mode: parsed.data.appearanceMode,
      accent_preset: parsed.data.accentPreset,
      custom_accent: parsed.data.customAccent || null,
    });
    if (candidate.contrastRatio < 4.5) {
      return c.json(
        {
          error: "The selected accent does not meet WCAG AA contrast.",
        },
        422
      );
    }
    const supabase = deps.requireSupabase(c.env);
    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          owner_email: email,
          appearance_mode: parsed.data.appearanceMode,
          accent_preset: parsed.data.accentPreset,
          custom_accent:
            parsed.data.accentPreset === "custom"
              ? parsed.data.customAccent
              : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_email" }
      )
      .select("appearance_mode,accent_preset,custom_accent")
      .single();
    if (error)
      return c.json({ error: "Could not save appearance settings." }, 500);
    await supabase.from("audit_logs").insert({
      actor_email: email,
      action: "update_appearance",
      target_type: "user_preferences",
      target_id: email,
      metadata: {
        appearanceMode: parsed.data.appearanceMode,
        accentPreset: parsed.data.accentPreset,
      },
    });
    return c.json({ appearance: appearanceResponse(data) });
  });
}
