import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;

export const strongPasswordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH)
  .max(200)
  .regex(/[A-Za-z]/)
  .regex(/[0-9]/);

export function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/\.{2,}/g, '.');
}

export function isValidNormalizedUsername(value: string): boolean {
  return value.length >= 3 &&
    value.length <= 40 &&
    /^[a-z0-9][a-z0-9._-]*$/.test(value);
}

export const passwordRequirements =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a letter and a number.`;
