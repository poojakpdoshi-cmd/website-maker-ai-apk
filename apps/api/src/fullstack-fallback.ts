import type { GeneratedProjectFile } from '@wmai/shared';

/**
 * Kept as a compatibility boundary for existing callers.
 *
 * The previous implementation silently invented an unrelated `items` API,
 * permissive database rules and schema. That made a failed coder look
 * successful. Full-stack artifacts must now come from the binding appSpec or
 * the coder; validation reports anything missing.
 */
export function ensureFullStackArtifacts(
  _request: string,
  files: GeneratedProjectFile[]
): GeneratedProjectFile[] {
  return files.map((file) => ({ ...file }));
}
