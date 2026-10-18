import type { EntityData } from '@tilewright/runtime';
import { TOOL_META, uniqueName } from '../tools/tools';
import type { ViewportController } from '../viewport/controller';
import { matches, parseKeySpec, formatKeySpec } from './keys';
import { store, type ToolId } from './store';
import { studio } from '../studio/store';

function undoStudio(): void {
  const d = studio.doc;
  if (d?.history.undo()) d.markChanged();
}

function redoStudio(): void {
  const d = studio.doc;
  if (d?.history.redo()) d.markChanged();
}

export const viewportRef: { current: ViewportController | null } = { current: null };

export interface Command {
  id: string;
  label: string;
  category: string;
  /** Default shortcut, e.g. "Ctrl+S". Empty for none. */
  keys: string;
  /** Hidden from the palette (internal, like tool hotkeys, are still listed in the shortcut editor). */
  run(): void;
  enabled?(): boolean;
}

const inEditor = (): boolean => store.state.screen === 'editor' && store.doc !== null;
const editing = (): boolean => inEditor() && store.state.mode === 'edit' && store.state.workspace === 'world';
const inStudio = (): boolean => inEditor() && store.state.workspace === 'sprites';

export function copySelection(): void {
  const doc = store.doc;
  if (!doc) return;
  const ents = doc.entities.filter((e) => store.state.selection.includes(e.id));
  if (ents.length === 0) return;
  store.clipboard = structuredClone(ents);
  store.notify('info', `Copied ${ents.length} object${ents.length > 1 ? 's' : ''}.`);
}

export function pasteClipboard(offset = 1): void {
  const doc = store.doc;
  if (!doc || store.clipboard.length === 0) return;
  const items: Omit<EntityData, 'id'>[] = store.clipboard.map((c) => {
    const copy = structuredClone(c) as Partial<EntityData> & Omit<EntityData, 'id'>;
    delete copy.id;
    const t = copy.components.transform as { x: number; y: number } | undefined;
    if (t) {
      t.x += offset;
      t.y += offset;
    }
    copy.name = uniqueName(doc, copy.name);
    // a scene has one player start: pasting never creates a second
    if (copy.tags.includes('player') && doc.entities.some((e) => e.tags.includes('player'))) copy.tags = copy.tags.filter((tag) => tag !== 'player');
    return copy;
  });
  const added = doc.addEntities(items, 'Paste');
  store.select(added.map((a) => a.id));
}

export function deleteSelection(): void {
  const doc = store.doc;
  if (!doc) return;
  const { selection, selectedRegion } = store.state;
  if (selection.length > 0) {
    doc.removeEntities(selection);
    store.select([]);
  } else if (selectedRegion) {
    doc.removeRegion(selectedRegion);
    store.set({ selectedRegion: null });
  }
}

export function rotateSelection(): void {
  const doc = store.doc;
  if (!doc || store.state.selection.length === 0) return;
  doc.updateEntities(store.state.selection, 'Rotate', (e) => {
    const t = e.components.transform as { facing: number } | undefined;
    if (t) t.facing = (t.facing + 2) % 8;
  });
}

export function buildCommands(): Command[] {
  const cmds: Command[] = [
    {
      id: 'file.save',
      label: 'Save (scene or sprite)',
      category: 'File',
      keys: 'Ctrl+S',
      run: () => void (store.state.workspace === 'sprites' ? studio.save() : store.save()),
      enabled: inEditor,
    },
    { id: 'file.newScene', label: 'New scene…', category: 'File', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:new-scene')), enabled: inEditor },
    { id: 'story.translations', label: 'Translations: languages and text…', category: 'Story', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:translations')) },
    { id: 'file.projectSettings', label: 'Project settings: name, title screen, controls…', category: 'File', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:project-settings')), enabled: inEditor },
    { id: 'tiles.autotile', label: 'Autotiling: edges, shores and cliff faces…', category: 'Tiles', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:autotile')) },
    { id: 'view.accessibility', label: 'Accessibility: text size, colours, motion…', category: 'View', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:accessibility')) },
    { id: 'help.tutorial', label: 'Start the tutorial', category: 'Help', keys: '', run: () => void import('../tutorial/store').then((m) => m.tutorial.start()), enabled: inEditor },
    { id: 'file.export', label: 'Export the game…', category: 'File', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:export')), enabled: inEditor },
    { id: 'file.close', label: 'Close project', category: 'File', keys: '', run: () => void store.closeProject(), enabled: inEditor },
    {
      id: 'edit.undo',
      label: 'Undo',
      category: 'Edit',
      keys: 'Ctrl+Z',
      run: () => (store.state.workspace === 'sprites' ? undoStudio() : void store.doc?.undo()),
      enabled: () => (editing() && !!store.doc?.history.canUndo) || (inStudio() && !!studio.doc?.history.canUndo),
    },
    {
      id: 'edit.redo',
      label: 'Redo',
      category: 'Edit',
      keys: 'Ctrl+Y',
      run: () => (store.state.workspace === 'sprites' ? redoStudio() : void store.doc?.redo()),
      enabled: () => (editing() && !!store.doc?.history.canRedo) || (inStudio() && !!studio.doc?.history.canRedo),
    },
    { id: 'edit.redo2', label: 'Redo (alternate)', category: 'Edit', keys: 'Ctrl+Shift+Z', run: () => (store.state.workspace === 'sprites' ? redoStudio() : void store.doc?.redo()), enabled: () => editing() || inStudio() },
    { id: 'workspace.world', label: 'Go to the World editor', category: 'App', keys: 'Ctrl+1', run: () => store.set({ workspace: 'world' }), enabled: inEditor },
    { id: 'workspace.sprites', label: 'Go to the Sprite studio', category: 'App', keys: 'Ctrl+2', run: () => store.set({ workspace: 'sprites' }), enabled: inEditor },
    { id: 'workspace.ui', label: 'Go to the UI designer', category: 'App', keys: 'Ctrl+4', run: () => store.set({ workspace: 'ui' }), enabled: inEditor },
    { id: 'workspace.code', label: 'Go to the Code editor', category: 'App', keys: 'Ctrl+3', run: () => store.set({ workspace: 'code' }), enabled: inEditor },
    { id: 'events.toCode', label: 'Convert the event sheet to a script', category: 'Scripts', keys: '', run: () => void store.convertEventsToScript().then((n) => n && store.set({ workspace: 'code' })), enabled: editing },
    { id: 'edit.delete', label: 'Delete selection', category: 'Edit', keys: 'Delete', run: deleteSelection, enabled: editing },
    { id: 'edit.delete2', label: 'Delete selection (Backspace)', category: 'Edit', keys: 'Backspace', run: deleteSelection, enabled: editing },
    { id: 'edit.copy', label: 'Copy', category: 'Edit', keys: 'Ctrl+C', run: copySelection, enabled: editing },
    { id: 'edit.paste', label: 'Paste', category: 'Edit', keys: 'Ctrl+V', run: () => pasteClipboard(), enabled: editing },
    {
      id: 'edit.duplicate',
      label: 'Duplicate',
      category: 'Edit',
      keys: 'Ctrl+D',
      run: () => {
        copySelection();
        pasteClipboard();
      },
      enabled: editing,
    },
    { id: 'edit.selectAll', label: 'Select all objects', category: 'Edit', keys: 'Ctrl+A', run: () => store.select(store.doc?.entities.map((e) => e.id) ?? []), enabled: editing },
    { id: 'edit.deselect', label: 'Deselect', category: 'Edit', keys: 'Escape', run: () => store.select([]), enabled: () => editing() && (store.state.selection.length > 0 || store.state.selectedRegion !== null) },
    { id: 'edit.rotate', label: 'Rotate selection', category: 'Edit', keys: 'R', run: rotateSelection, enabled: () => editing() && store.state.tool === 'select' && store.state.selection.length > 0 },
    { id: 'play.toggle', label: 'Play', category: 'Play', keys: 'F5', run: () => (store.state.mode === 'play' ? store.togglePause() : store.play()), enabled: inEditor },
    { id: 'play.window', label: 'Run the game in its own window', category: 'Play', keys: 'F8', run: () => void store.runInWindow(), enabled: inEditor },
    { id: 'play.stop', label: 'Stop', category: 'Play', keys: 'Shift+F5', run: () => store.stop(), enabled: () => store.state.mode === 'play' },
    { id: 'play.stop2', label: 'Stop (Escape)', category: 'Play', keys: 'Escape', run: () => store.stop(), enabled: () => store.state.mode === 'play' },
    { id: 'play.pause', label: 'Pause / resume', category: 'Play', keys: 'F6', run: () => store.togglePause(), enabled: () => store.state.mode === 'play' },
    { id: 'play.reload', label: 'Reload the game with my edits', category: 'Play', keys: 'F7', run: () => store.requestHotReload(), enabled: () => store.state.mode === 'play' },
    { id: 'play.step', label: 'Step one frame', category: 'Play', keys: 'F10', run: () => store.step(), enabled: () => store.state.mode === 'play' },
    {
      id: 'play.fromHere',
      label: 'Play from here (the cell under the mouse)',
      category: 'Play',
      keys: 'Ctrl+Enter',
      run: () => store.play(viewportRef.current?.playFromHere ?? undefined),
      enabled: editing,
    },
    { id: 'view.grid', label: 'Show / hide grid', category: 'View', keys: 'Ctrl+G', run: () => store.setView({ grid: !store.state.view.grid }), enabled: inEditor },
    { id: 'view.collision', label: 'Show / hide collision colours', category: 'View', keys: 'Ctrl+Shift+C', run: () => store.setView({ collision: !store.state.view.collision }), enabled: inEditor },
    { id: 'view.heights', label: 'Show / hide height numbers', category: 'View', keys: 'Ctrl+Shift+H', run: () => store.setView({ heightLabels: !store.state.view.heightLabels }), enabled: inEditor },
    { id: 'view.frame', label: 'Frame the whole map', category: 'View', keys: 'Home', run: () => viewportRef.current?.frameMap(), enabled: editing },
    {
      id: 'view.focusSelection',
      label: 'Focus on selection',
      category: 'View',
      keys: 'F',
      run: () => {
        const e = store.doc?.entities.find((x) => x.id === store.state.selection[0]);
        const t = e?.components.transform as { x: number; y: number } | undefined;
        if (t) viewportRef.current?.focusCell(t.x, t.y);
      },
      enabled: () => editing() && store.state.selection.length > 0,
    },
    { id: 'view.zoomIn', label: 'Zoom in', category: 'View', keys: '+', run: () => viewportRef.current?.zoomBy(1.25), enabled: editing },
    { id: 'view.zoomOut', label: 'Zoom out', category: 'View', keys: '-', run: () => viewportRef.current?.zoomBy(0.8), enabled: editing },
    { id: 'app.palette', label: 'Command palette', category: 'App', keys: 'Ctrl+K', run: () => document.dispatchEvent(new CustomEvent('tw:palette')) },
    { id: 'app.shortcuts', label: 'Keyboard shortcuts…', category: 'App', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:shortcuts')) },
    { id: 'app.theme', label: 'Switch light / dark theme', category: 'App', keys: '', run: () => store.setTheme(store.state.theme === 'dark' ? 'light' : 'dark') },
    { id: 'app.resetLayout', label: 'Reset panel layout', category: 'App', keys: '', run: () => document.dispatchEvent(new CustomEvent('tw:reset-layout')), enabled: inEditor },
  ];

  for (const t of TOOL_META) {
    cmds.push({
      id: `tool.${t.id}`,
      label: `Tool: ${t.label}`,
      category: 'Tools',
      keys: t.hotkey ?? '',
      run: () => store.set({ tool: t.id as ToolId }),
      enabled: editing,
    });
  }
  return cmds;
}

export const COMMANDS = buildCommands();

/** The shortcut in effect for a command (user override or default). */
export function keysFor(cmd: Command, overrides: Record<string, string>): string {
  return cmd.id in overrides ? overrides[cmd.id]! : cmd.keys;
}

/** Find the command a key press should run, preferring commands with modifiers (more specific). */
export function commandForKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  overrides: Record<string, string>,
  commands: Command[] = COMMANDS,
): Command | undefined {
  const candidates = commands.filter((c) => {
    const k = keysFor(c, overrides);
    return k !== '' && matches(k, e) && (c.enabled?.() ?? true);
  });
  candidates.sort((a, b) => specificity(keysFor(b, overrides)) - specificity(keysFor(a, overrides)));
  return candidates[0];
}

function specificity(spec: string): number {
  const s = parseKeySpec(spec);
  return (s.ctrl ? 4 : 0) + (s.alt ? 2 : 0) + (s.shift ? 1 : 0);
}

export function describeKeys(spec: string): string {
  return spec ? formatKeySpec(parseKeySpec(spec)) : '';
}
