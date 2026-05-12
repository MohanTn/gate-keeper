import { Fix } from '../types';

/**
 * Render either a string Fix or a Fix object to a single line of text suitable
 * for markdown reports. Returns undefined when no fix is present.
 */
export function fixText(fix: Fix | string | undefined): string | undefined {
  if (fix == null) return undefined;
  return typeof fix === 'string' ? fix : fix.description;
}
