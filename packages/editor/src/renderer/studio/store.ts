import { useSyncExternalStore } from 'react';
import { AudioEngine, type SpriteData } from '@tilewright/runtime';
import { store } from '../app/store';
import { assetFs } from '../project/assetFs';
import { api } from '../project/api';
import {
  blankSprite,
  deleteSprite,
  exportSpriteSheet,
  importAny,
  loadAllSprites,
  loadMeta,
  saveMeta,
  saveSprite,
  spriteNameProblem,
  type AssetMeta,
} from './assets';
import { AUDIO_DIR, deleteSound, importSound, listSounds, type SoundFile } from './audio';
import { joinPath } from '../project/api';
import { AUDIO_EXTENSIONS } from '@tilewright/runtime';
import { SpriteDoc } from './doc';

export type StudioTool = 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'select' | 'isobox' | 'origin' | 'hitbox' | 'hurtbox';

export interface StudioState {
  tool: StudioTool;
  /** Palette index used by drawing tools. */
  color: number;
  size: number;
  filled: boolean;
  symX: boolean;
  symY: boolean;
  onionPrev: boolean;
  onionNext: boolean;
  zoom: number;
  pixelGrid: boolean;
  isoGrid: boolean;
  showBoxes: boolean;
  isoBox: { w: number; d: number; h: number; s: number };
  /** Names of the sprites in the project. */
  names: string[];
  openName: string | null;
  /** Bumped on every change to the open sprite so panels re-render. */
  docVersion: number;
  assetsVersion: number;
  problems: string[];
  lastExport: string | null;
  query: string;
}

const initial: StudioState = {
  tool: 'pencil',
  color: 3,
  size: 1,
  filled: true,
  symX: false,
  symY: false,
  onionPrev: false,
  onionNext: false,
  zoom: 10,
  pixelGrid: true,
  isoGrid: false,
  showBoxes: true,
  isoBox: { w: 1, d: 1, h: 24, s: 16 },
  names: [],
  openName: null,
  docVersion: 0,
  assetsVersion: 0,
  problems: [],
  lastExport: null,
  query: '',
};


type Listener = () => void;

/**
 * State of the sprite studio and the project's drawn sprites.
 * `assets` is the saved version of every sprite (what the game and the world editor use);
 * `doc` is the sprite currently open for editing (changes reach `assets` when you save).
 */
class StudioStore {
  state: StudioState = initial;
  doc: SpriteDoc | null = null;
  assets = new Map<string, SpriteData>();
  meta: AssetMeta = { tags: {} };
  /** The project's sound and music files. */
  sounds: SoundFile[] = [];
  private preview: AudioEngine | null = null;
  private listeners = new Set<Listener>();
  private unsubDoc: (() => void) | null = null;
  private tick: number | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): StudioState => this.state;

  set(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private projectDir(): string | null {
    return store.state.project?.dir ?? null;
  }

  /** Read every sprite in the open project. Damaged ones are listed as problems, not fatal. */
  async loadAssets(): Promise<void> {
    const dir = this.projectDir();
    this.closeSprite();
    if (!dir) {
      this.assets = new Map();
      this.sounds = [];
      this.set({ names: [], problems: [], assetsVersion: this.state.assetsVersion + 1 });
      return;
    }
    this.sounds = await listSounds(assetFs, dir);
    this.preview?.dispose();
    this.preview = null;
    const { sprites, problems } = await loadAllSprites(assetFs, dir);
    this.assets = sprites;
    this.meta = await loadMeta(assetFs, dir);
    this.set({ names: [...sprites.keys()], problems, assetsVersion: this.state.assetsVersion + 1 });
  }

  /** Open a saved sprite for editing. */
  openSprite(name: string): void {
    const data = this.assets.get(name);
    if (!data) return;
    this.attach(SpriteDoc.fromSprite(data), name);
  }

  closeSprite(): void {
    this.unsubDoc?.();
    this.unsubDoc = null;
    this.doc = null;
    this.set({ openName: null, docVersion: this.state.docVersion + 1 });
  }

  private attach(doc: SpriteDoc, name: string): void {
    this.unsubDoc?.();
    this.doc = doc;
    this.unsubDoc = doc.subscribe(() => this.bump());
    const color = this.state.color < doc.palette.length ? this.state.color : 1;
    this.set({ openName: name, color, docVersion: this.state.docVersion + 1 });
  }

  /** Coalesce bursts of changes into one React update per frame. */
  private bump(): void {
    if (this.tick !== null) return;
    this.tick = window.requestAnimationFrame(() => {
      this.tick = null;
      this.set({ docVersion: this.state.docVersion + 1 });
    });
  }

  async newSprite(name: string, width: number, height: number): Promise<boolean> {
    const dir = this.projectDir();
    if (!dir) return false;
    const problem = spriteNameProblem(name, this.state.names);
    if (problem) {
      store.notify('warn', problem);
      return false;
    }
    const data = blankSprite(name.trim(), Math.max(1, Math.min(512, width)), Math.max(1, Math.min(512, height)));
    return (await store.guard('Creating the sprite', async () => {
      await saveSprite(assetFs, dir, data);
      this.assets.set(data.name, data);
      this.set({ names: [...this.assets.keys()].sort((a, b) => a.localeCompare(b)), assetsVersion: this.state.assetsVersion + 1 });
      this.openSprite(data.name);
      return true;
    })) === true;
  }

  /** Save the open sprite to the project; the world editor and the game pick it up at once. */
  async save(): Promise<boolean> {
    const dir = this.projectDir();
    const doc = this.doc;
    if (!dir || !doc) return false;
    const data = doc.toSprite();
    const ok = await store.guard('Saving the sprite', async () => {
      await saveSprite(assetFs, dir, data);
      this.assets.set(data.name, data);
      doc.dirty = false;
      this.set({ names: [...this.assets.keys()].sort((a, b) => a.localeCompare(b)), assetsVersion: this.state.assetsVersion + 1, docVersion: this.state.docVersion + 1 });
      return true;
    });
    if (ok) store.notify('info', `Saved sprite "${data.name}".`);
    return ok === true;
  }

  async remove(name: string): Promise<void> {
    const dir = this.projectDir();
    if (!dir) return;
    await store.guard('Deleting the sprite', async () => {
      await deleteSprite(assetFs, dir, name);
      this.assets.delete(name);
      if (this.state.openName === name) this.closeSprite();
      this.set({ names: [...this.assets.keys()], assetsVersion: this.state.assetsVersion + 1 });
    });
  }

  /** Pick a PNG / Aseprite file and turn it into a sprite. */
  async importFile(): Promise<string | null> {
    const dir = this.projectDir();
    if (!dir) return null;
    const result = await store.guard('Importing', async () => {
      const file = await api().importFile('Import a PNG or Aseprite file', ['png', 'ase', 'aseprite']);
      if (!file) return null;
      const imported = importAny(file);
      let name = imported.sprite.name;
      for (let i = 2; spriteNameProblem(name, this.state.names); i++) name = `${imported.sprite.name} ${i}`;
      const sprite = { ...imported.sprite, name };
      await saveSprite(assetFs, dir, sprite);
      this.assets.set(name, sprite);
      this.set({ names: [...this.assets.keys()].sort((a, b) => a.localeCompare(b)), assetsVersion: this.state.assetsVersion + 1 });
      store.notify('info', imported.notes.join(' '));
      return name;
    });
    return result ?? null;
  }

  async exportSheet(opts: { maxWidth: number; padding: number; trim: boolean; powerOfTwo: boolean }): Promise<void> {
    const dir = this.projectDir();
    const doc = this.doc;
    if (!dir || !doc) return;
    await store.guard('Exporting', async () => {
      const r = await exportSpriteSheet(assetFs, dir, doc.toSprite(), opts);
      this.set({ lastExport: `${r.width} x ${r.height} sheet written to assets/sprites/${doc.name}.sheet.png (and ${doc.name}.atlas.json)` });
      store.notify('info', `Exported a ${r.width} x ${r.height} sprite sheet.`);
    });
  }

  async setTags(name: string, tags: string[]): Promise<void> {
    const dir = this.projectDir();
    if (!dir) return;
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    this.meta = { tags: { ...this.meta.tags, [name]: clean } };
    if (clean.length === 0) delete this.meta.tags[name];
    await saveMeta(assetFs, dir, this.meta);
    this.set({ assetsVersion: this.state.assetsVersion + 1 });
  }

  /** Pick a sound file and add it to the project. */
  async importSoundFile(): Promise<string | null> {
    const dir = this.projectDir();
    if (!dir) return null;
    const result = await store.guard('Importing the sound', async () => {
      const file = await api().importFile('Add a sound or music file', AUDIO_EXTENSIONS);
      if (!file) return null;
      const added = await importSound(assetFs, dir, file);
      this.sounds = await listSounds(assetFs, dir);
      this.set({ assetsVersion: this.state.assetsVersion + 1 });
      store.notify('info', `Added the sound "${added.name}". Use that name in a Play a sound action, a cutscene or a region's music.`);
      return added.name;
    });
    return result ?? null;
  }

  async removeSound(file: string): Promise<void> {
    const dir = this.projectDir();
    if (!dir) return;
    await store.guard('Deleting the sound', async () => {
      await deleteSound(assetFs, dir, file);
      this.sounds = await listSounds(assetFs, dir);
      this.preview?.dispose();
      this.preview = null;
      this.set({ assetsVersion: this.state.assetsVersion + 1 });
    });
  }

  /** Play a sound once so you can hear what it is (the editor's own player, not the game's). */
  async previewSound(file: SoundFile): Promise<void> {
    const dir = this.projectDir();
    if (!dir) return;
    await store.guard('Playing the sound', async () => {
      this.preview ??= new AudioEngine();
      await this.preview.unlock();
      if (!this.preview.has(file.name)) {
        const ok = await this.preview.load(file.name, await assetFs.readBinary(joinPath(dir, AUDIO_DIR, file.file)));
        if (!ok) throw new Error(this.preview.problems.splice(0).join(' ') || 'That sound could not be played.');
      }
      this.preview.play(file.name);
    });
  }

  isDirty(): boolean {
    return !!this.doc?.dirty;
  }
}

export const studio = new StudioStore();

export { assetFs };

export function useStudio<T>(selector: (s: StudioState) => T): T {
  return useSyncExternalStore(studio.subscribe, () => selector(studio.getState()));
}
