/** Flatten a JSON value into `path -> leaf` so two reports can be compared and the differences listed one per line. */
export function flatten(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(v)) {
    if (v.length === 0) out[prefix || '(root)'] = '[]';
    v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v as object);
    if (keys.length === 0) out[prefix || '(root)'] = '{}';
    for (const k of keys) flatten((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || '(root)'] = JSON.stringify(v);
  return out;
}

/** The differences between a baseline and a fresh report, as readable lines (empty when they are the same). */
export function differences(baseline: unknown, now: unknown, limit = 40): string[] {
  const a = flatten(baseline);
  const b = flatten(now);
  const lines: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === b[k]) continue;
    lines.push(a[k] === undefined ? `+ ${k}: ${b[k]}` : b[k] === undefined ? `- ${k}: ${a[k]}` : `~ ${k}: ${a[k]}  ->  ${b[k]}`);
  }
  if (lines.length > limit) return [...lines.slice(0, limit), `... and ${lines.length - limit} more`];
  return lines;
}
