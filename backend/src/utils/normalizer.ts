import crypto from 'node:crypto';

export interface NormalizedPromptResult {
  rawPrompt: string;
  cleanPrompt: string;
  exactHash: string;
}

/**
 * Normalizes developer prompts to maximize semantic cache hit rate across environments.
 * 1. Replaces local system file paths (Unix & Windows) with `<FILE_PATH>`.
 * 2. Converts text to lowercase and strips redundant whitespace/newlines.
 * 3. Calculates a SHA-256 hex string digest for O(1) exact match evaluation.
 */
export function normalizePrompt(rawPrompt: string): NormalizedPromptResult {
  if (!rawPrompt) {
    return {
      rawPrompt: '',
      cleanPrompt: '',
      exactHash: crypto.createHash('sha256').update('').digest('hex'),
    };
  }

  // Regex matching Unix (/Users/..., /home/..., /var/..., ./src/...) and Windows (C:\..., D:\...) paths
  const unixPathRegex = /(?:\/[\w.-]+)+\/[\w.-]+\.[\w]+/g;
  const winPathRegex = /[a-zA-Z]:\\(?:[\w.-]+\\)+[\w.-]+\.[\w]+/g;

  let cleanPrompt = rawPrompt
    .replace(unixPathRegex, '<FILE_PATH>')
    .replace(winPathRegex, '<FILE_PATH>');

  // Normalize case & collapse extra whitespace
  cleanPrompt = cleanPrompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Compute SHA-256 hash
  const exactHash = crypto
    .createHash('sha256')
    .update(cleanPrompt)
    .digest('hex');

  return {
    rawPrompt,
    cleanPrompt,
    exactHash,
  };
}
