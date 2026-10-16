/**
 * The models the assistant can use, and what they cost. This file is the only place a model name appears:
 * everything else asks for `DEFAULT_MODEL` or whatever the user picked in the assistant's settings.
 */

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
  /** US dollars per million tokens. */
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
}

export const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best all-round choice for building levels and fixing problems.', inputPerMillion: 4, outputPerMillion: 20, cacheReadPerMillion: 0.2 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster and cheaper; good for explaining and small changes.', inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest and cheapest; best for quick questions.', inputPerMillion: 0.1, outputPerMillion: 0.5, cacheReadPerMillion: 0.01 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', note: 'Most capable and most expensive; for hard puzzles.', inputPerMillion: 10, outputPerMillion: 50, cacheReadPerMillion: 0.25 },
];

/** The model used until the user picks another one. */
export const DEFAULT_MODEL = MODELS[0]!.id;

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = 'high';

export const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Quick (low effort)',
  medium: 'Balanced (medium)',
  high: 'Thorough (high)',
  xhigh: 'Very thorough (extra high)',
  max: 'Maximum',
};

export interface AssistantSettings {
  model: string;
  effort: Effort;
  /** Let the API re-run a request on another model when the first one declines it. */
  fallback: boolean;
}

export const DEFAULT_SETTINGS: AssistantSettings = { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, fallback: true };

/** Make whatever was saved (possibly from an older version, possibly hand-edited) into valid settings. */
export function cleanSettings(raw: unknown): AssistantSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim() : DEFAULT_SETTINGS.model;
  const effort = (EFFORTS as readonly unknown[]).includes(r.effort) ? (r.effort as Effort) : DEFAULT_SETTINGS.effort;
  const fallback = typeof r.fallback === 'boolean' ? r.fallback : DEFAULT_SETTINGS.fallback;
  return { model, effort, fallback };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the prompt cache (billed a little above normal input). */
  cacheWriteTokens: number;
  /** Tokens read back from the prompt cache (billed at a small fraction). */
  cacheReadTokens: number;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

/** The `usage` object of an API response, in our shape. */
export function usageOf(u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  };
}

/** Estimated cost in US dollars (list prices; a model not in the table is priced like the default). */
export function estimateCost(model: string, u: Usage): number {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0]!;
  const per = 1 / 1_000_000;
  return (u.inputTokens * m.inputPerMillion + u.cacheWriteTokens * m.inputPerMillion * 1.25 + u.cacheReadTokens * m.cacheReadPerMillion + u.outputTokens * m.outputPerMillion) * per;
}

export function formatCost(dollars: number): string {
  if (dollars < 0.005) return dollars === 0 ? '$0.00' : '< $0.01';
  return `$${dollars.toFixed(2)}`;
}
