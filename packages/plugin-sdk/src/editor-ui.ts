import type { ReactElement } from 'react';
import type { DataEditorProps } from '@tilewright/behaviors';

/**
 * The fields the editor draws its own panels with, handed to the editor of a kind of data in `props.ui` so a plugin's tab looks and
 * behaves like the rest of the editor: a text or number is saved when the person leaves the field (so typing never floods the undo
 * list), a choice is a list, a check is a box. Write the tab with React and take the fields from `ui`:
 *
 *     export function ItemsEditor(props: DataEditorProps) {
 *       const { TextField } = props.ui as EditorUi;
 *       ...
 */
export interface EditorUi {
  TextField(props: { label: string; value: string; onCommit(v: string): void; testId?: string; placeholder?: string; suggestions?: readonly string[] }): ReactElement;
  NumberField(props: { label: string; value: number; onCommit(v: number): void; step?: number; min?: number; max?: number; testId?: string }): ReactElement;
  CheckField(props: { label: string; value: boolean; onChange(v: boolean): void; testId?: string }): ReactElement;
  SelectField<T extends string | number>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void; testId?: string }): ReactElement;
  /** A colour as a number (0xRRGGBB) to the "#rrggbb" a colour input wants, and back. */
  numberToHex(n: number): string;
  hexToNumber(hex: string): number;
}

export type { DataEditorProps };
