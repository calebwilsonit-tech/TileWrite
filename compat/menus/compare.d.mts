export interface Row {
  label: string;
  detail: string;
  focused: boolean;
}
export interface Recorded {
  step: string;
  waits: boolean;
  title: string;
  rows: Row[];
  hints: string[];
  settings?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  scene?: string;
}
export interface Difference {
  step: string;
  note: string;
}
export function compareRecordings(older: Recorded[], newer: Recorded[]): Difference[];
export function sortOut(diffs: Difference[]): { explained: (Difference & { why: string })[]; unexplained: Difference[] };
export function readRecording(file: string): Recorded[];
