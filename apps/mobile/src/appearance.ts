export type AppearanceMode = "system" | "light" | "dark";
export type AccentPreset =
  | "nexora-cyan"
  | "violet"
  | "blue"
  | "emerald"
  | "rose"
  | "gold"
  | "custom";

export type AppearanceSettings = {
  appearanceMode: AppearanceMode;
  accentPreset: AccentPreset;
  customAccent: string | null;
};

export const appearanceStorageKey = "nexora-appearance-v2";

export const accentPresets: Array<{
  id: Exclude<AccentPreset, "custom">;
  label: string;
  colour: string;
}> = [
  { id: "nexora-cyan", label: "Nexora Cyan", colour: "#06b6d4" },
  { id: "violet", label: "Violet", colour: "#8b5cf6" },
  { id: "blue", label: "Blue", colour: "#2563eb" },
  { id: "emerald", label: "Emerald", colour: "#059669" },
  { id: "rose", label: "Rose", colour: "#e11d48" },
  { id: "gold", label: "Gold", colour: "#b7791f" },
];

export const defaultAppearance: AppearanceSettings = {
  appearanceMode: "system",
  accentPreset: "nexora-cyan",
  customAccent: null,
};

function isHexColour(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AppearanceSettings>)
      : {};
  const mode = candidate.appearanceMode;
  const preset = candidate.accentPreset;
  const validMode =
    mode === "system" || mode === "light" || mode === "dark"
      ? mode
      : defaultAppearance.appearanceMode;
  const validPreset: AccentPreset =
    accentPresets.some((item) => item.id === preset) || preset === "custom"
      ? (preset as AccentPreset)
      : defaultAppearance.accentPreset;
  return {
    appearanceMode: validMode,
    accentPreset: validPreset,
    customAccent: isHexColour(candidate.customAccent)
      ? candidate.customAccent.toLowerCase()
      : null,
  };
}

export function loadAppearance(
  storage: Pick<Storage, "getItem"> = localStorage
): AppearanceSettings {
  try {
    const saved = storage.getItem(appearanceStorageKey);
    if (saved) return normalizeAppearance(JSON.parse(saved));
    const legacy = storage.getItem("nexora-appearance");
    if (legacy === "system" || legacy === "light" || legacy === "dark") {
      return { ...defaultAppearance, appearanceMode: legacy };
    }
  } catch {
    // Invalid local values must never prevent the login screen from rendering.
  }
  return { ...defaultAppearance };
}

export function saveAppearance(
  value: AppearanceSettings,
  storage: Pick<Storage, "setItem"> = localStorage
): AppearanceSettings {
  const normalized = normalizeAppearance(value);
  storage.setItem(appearanceStorageKey, JSON.stringify(normalized));
  return normalized;
}

export function resolveAccent(value: AppearanceSettings): string {
  if (value.accentPreset === "custom" && isHexColour(value.customAccent)) {
    return value.customAccent;
  }
  return (
    accentPresets.find((item) => item.id === value.accentPreset)?.colour ||
    accentPresets[0].colour
  );
}

export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastForAccent(accent: string): {
  text: "#ffffff" | "#000000";
  ratio: number;
  accessible: boolean;
} {
  const luminosity = relativeLuminance(accent);
  const againstWhite = 1.05 / (luminosity + 0.05);
  const againstBlack = (luminosity + 0.05) / 0.05;
  const text = againstWhite >= againstBlack ? "#ffffff" : "#000000";
  const ratio = Math.max(againstWhite, againstBlack);
  return { text, ratio, accessible: ratio >= 4.5 };
}

export function applyAppearance(
  value: AppearanceSettings,
  root: HTMLElement = document.documentElement,
  prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
): void {
  const resolvedMode =
    value.appearanceMode === "system"
      ? prefersDark
        ? "dark"
        : "light"
      : value.appearanceMode;
  const accent = resolveAccent(value);
  const contrast = contrastForAccent(accent);
  root.dataset.nexoraTheme = resolvedMode;
  root.style.colorScheme = resolvedMode;
  root.style.setProperty("--nx-accent", accent);
  root.style.setProperty("--nx-accent-contrast", contrast.text);
  root.style.setProperty("--nx-cyan", accent);
  root.style.setProperty("--wf-accent", accent);
}

export type WebsitePalette = {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  background: string;
  text: string;
};

export const websitePalettes: WebsitePalette[] = [
  {
    id: "auto",
    label: "AI decides",
    primary: "",
    secondary: "",
    background: "",
    text: "",
  },
  {
    id: "ocean",
    label: "Ocean",
    primary: "#2563eb",
    secondary: "#06b6d4",
    background: "#f8fbff",
    text: "#0f172a",
  },
  {
    id: "violet",
    label: "Violet",
    primary: "#7c3aed",
    secondary: "#c026d3",
    background: "#faf5ff",
    text: "#1e1033",
  },
  {
    id: "forest",
    label: "Forest",
    primary: "#047857",
    secondary: "#84cc16",
    background: "#f7fee7",
    text: "#132a13",
  },
  {
    id: "ember",
    label: "Ember",
    primary: "#dc2626",
    secondary: "#f59e0b",
    background: "#fff7ed",
    text: "#2b1208",
  },
  {
    id: "mono",
    label: "Monochrome",
    primary: "#18181b",
    secondary: "#71717a",
    background: "#fafafa",
    text: "#09090b",
  },
];
