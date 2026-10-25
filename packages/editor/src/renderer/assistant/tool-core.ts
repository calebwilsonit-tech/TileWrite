import type { ApprovalClass, DiffLine } from '@tilewright/assistant';
import { store } from '../app/store';
import type { EditorDoc } from '../model/doc';

/** A change Claude proposes. Nothing happens until `apply` is called (when the person approves it). */
export interface Proposal {
  tool: string;
  title: string;
  /** What it will do, one plain-English line each. */
  lines: string[];
  /** For text (scripts, notes, the event sheet): what changes. */
  diff?: { name: string; lines: DiffLine[] };
  /** Pictures to show with the card: what a drawing will look like, or what a picture maker made (set again by apply). */
  images?: { name: string; png: Uint8Array }[];
  /** A plan the person approves before Claude changes anything (see the permission levels). */
  plan?: { steps: string[]; risks: string[] };
  /** Set when this change is always asked about, whatever the permission level (a plugin's own tool, for example). */
  ask?: ApprovalClass;
  /** Does the change; returns what to tell Claude. */
  apply(): Promise<string>;
  /** Take it back (only offered right after applying). */
  undo?(): Promise<boolean>;
}

/** A mistake in what Claude asked for, worded so Claude can correct itself. */
export class ToolProblem extends Error {}

export const fail = (message: string): never => {
  throw new ToolProblem(message);
};

export const json = (v: unknown, indent = 1): string => JSON.stringify(v, null, indent);

export function requireDoc(): EditorDoc {
  const doc = store.doc;
  if (!doc) return fail('No scene is open. Ask the user to open a project and a scene first.');
  return doc;
}

export function requireEditing(): EditorDoc {
  const doc = requireDoc();
  if (store.state.mode === 'play') fail('The game is running. Ask the user to stop it (Stop button) before changing the project.');
  return doc;
}

/** Undo the change just made, but only if nothing else has been done since (the top of the undo list is still it). */
export const undoTop = (doc: EditorDoc, undoLabel: string) => async (): Promise<boolean> => {
  if (store.doc !== doc || doc.history.undoLabel !== undoLabel) return false;
  doc.undo();
  return true;
};
