import { useEffect, useId, useState } from 'react';

/** Text input that only commits on Enter or blur, so typing never creates a flood of undo steps. */
export function TextField({ label, value, onCommit, testId, placeholder, suggestions }: { label: string; value: string; onCommit(v: string): void; testId?: string; placeholder?: string; suggestions?: readonly string[] }) {
  const [draft, setDraft] = useState(value);
  const listId = useId();
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        data-testid={testId}
        value={draft}
        placeholder={placeholder}
        list={suggestions ? listId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  min,
  max,
  testId,
}: {
  label: string;
  value: number;
  onCommit(v: number): void;
  step?: number;
  min?: number;
  max?: number;
  testId?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
    else setDraft(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        data-testid={testId}
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

export function CheckField({ label, value, onChange, testId }: { label: string; value: boolean; onChange(v: boolean): void; testId?: string }) {
  return (
    <label className="field check">
      <input data-testid={testId} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function SelectField<T extends string | number>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void; testId?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        data-testid={testId}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const hexToNumber = (hex: string): number => parseInt(hex.replace('#', ''), 16) || 0;
export const numberToHex = (n: number): string => `#${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, '0')}`;
