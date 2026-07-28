export type RuntimeConfig = {
  apiBase: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export function cleanRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    apiBase: config.apiBase.trim().replace(/\/$/, ''),
    supabaseUrl: config.supabaseUrl.trim().replace(/\/$/, ''),
    supabaseAnonKey: config.supabaseAnonKey.trim()
  };
}

export function validRuntimeConfig(config: RuntimeConfig): boolean {
  return /^https?:\/\//.test(config.apiBase) &&
    /^https:\/\//.test(config.supabaseUrl) &&
    config.supabaseAnonKey.length > 20;
}

export function resolveRuntimeConfig(
  bundled: RuntimeConfig,
  storedValue: string | null,
  allowStoredOverride: boolean
): RuntimeConfig {
  const cleanBundled = cleanRuntimeConfig(bundled);

  if (!allowStoredOverride || !storedValue) return cleanBundled;

  try {
    const stored = cleanRuntimeConfig(JSON.parse(storedValue) as RuntimeConfig);
    return validRuntimeConfig(stored) ? stored : cleanBundled;
  } catch {
    return cleanBundled;
  }
}
