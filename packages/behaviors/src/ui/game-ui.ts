import {
  ACTION_LABELS,
  availableSkins,
  bindingLabel,
  carried,
  languageChoices,
  quickSlots,
  type GameSettings,
  type InputMapDef,
  type SlotInfo,
  type Simulation,
} from '@tilewright/runtime';
import { healthOf } from '../builtins/combat';
import { litPosts, type LitPost } from '../builtins/story';
import { contextOf } from '../story/context';
import { confirmDialogue, selectChoice } from '../story/director';
import { useItem } from '../story/inventory';

/** What the screens need from whoever is running the game (the editor's Play, or an exported game). */
export interface GameUiHost {
  sim: Simulation;
  settings: GameSettings;
  bindings(): InputMapDef;
  changeSettings(patch: Partial<GameSettings>): void;
  rebind(action: string, binding: string): void;
  resetBindings(): void;
  /** Resolves with the next key or button the player presses (null on timeout). */
  captureNext(): Promise<string | null>;
  /** Start the current scene again from the beginning. */
  restart(): void;
  saveTo(slot: string): Promise<string>;
  loadFrom(slot: string): Promise<string>;
  slots(): Promise<SlotInfo[]>;
  travelTo(post: LitPost): void;
  quit?(): void;
  /** Full screen on and off; only a game running in its own window can offer it. */
  fullscreen?: { get(): boolean; set(on: boolean): void };
}

/**
 * Every fixed piece of text in the game's own screens. The translation tables list these so a language can cover the
 * menus too; `{name}`-style parts are filled in after translating. (A test keeps this list complete.)
 */
export const UI_STRINGS: readonly string[] = [
  'Paused', 'Resume', 'Inventory', 'Travel to a lit lantern', 'Save game', 'Load game', 'Settings', 'Restart this area', 'Quit',
  '{n} lit', 'You are carrying nothing.', 'press E to use', 'slot {n}', 'E: use   A / D: choose its quick slot   Esc: back',
  'No lanterns lit yet. Light one by pressing E beside it.', 'this area', 'Autosave', 'Slot {n}', 'damaged', 'empty',
  'Master volume', 'Music volume', 'Effects volume', 'Difficulty', 'easy', 'normal', 'hard', 'Screen shake and hit freeze', 'on', 'off',
  'Camera zoom', 'Full screen', 'Show frame rate', 'Appearance', 'Original', 'Language', 'Default', 'Controls', 'press a key or button...', 'not set', 'Reset all controls',
  'E: change the selected control, then press the new key or button', 'W / S to choose, E to select, Esc or P to go back',
  'E / click: continue', 'P / Start: skip', 'Received {item}', 'Used {item}', 'You were defeated.',
  'Echo made.', 'You cannot make echoes yet.', 'Recording... press Echo again to finish.',
  '{name} is lit.', 'Rested at {name}.', '{name} gets angry!', '{name} is defeated!',
];

/** Every fixed text of the game's screens, including the names of the controls. */
export const uiStrings = (): string[] => [...new Set([...UI_STRINGS, ...Object.values(ACTION_LABELS)])];

type Screen = 'main' | 'inventory' | 'travel' | 'save' | 'load' | 'settings' | 'controls';

interface Row {
  label: string;
  detail?: string;
  /** Pressed with the confirm button (or a click). */
  run?: () => void;
  /** Left/right while focused: sliders and choices. */
  adjust?: (delta: number) => void;
  testId?: string;
}

const CSS = `
.tw-ui { position: absolute; inset: 0; pointer-events: none; font-family: Georgia, 'Times New Roman', serif; color: #f4efe6; user-select: none; }
.tw-ui * { box-sizing: border-box; }
.tw-hud { position: absolute; top: 10px; left: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; text-shadow: 0 1px 3px #000; }
.tw-hearts { font-size: 22px; letter-spacing: 3px; }
.tw-hearts .full { color: #ff5d6c; } .tw-hearts .empty { color: #8a8f9c; }
.tw-slots { display: flex; gap: 6px; }
.tw-slot { width: 44px; height: 44px; border: 2px solid #ffffff55; border-radius: 8px; background: #14161bcc; display: flex; align-items: center; justify-content: center; position: relative; font-size: 11px; }
.tw-slot .key { position: absolute; top: 1px; left: 4px; opacity: .7; }
.tw-slot .count { position: absolute; bottom: 1px; right: 4px; }
.tw-slot .gem { width: 20px; height: 20px; border-radius: 5px; }
.tw-boss { align-self: center; width: min(60%, 480px); text-align: center; font-size: 13px; }
.tw-boss .bar { height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; margin-top: 3px; }
.tw-boss .fill { height: 100%; background: linear-gradient(90deg, #b3366e, #e0566b); }
.tw-toasts { position: absolute; right: 14px; bottom: 14px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.tw-toast { background: #14161bdd; border-left: 4px solid #6aa8ff; padding: 7px 12px; border-radius: 4px; font-size: 14px; }
.tw-fade { position: absolute; inset: 0; background: #000; opacity: 0; }
.tw-skip { position: absolute; top: 12px; right: 16px; font-size: 12px; opacity: .75; text-shadow: 0 1px 3px #000; }
.tw-dialogue { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(80%, 760px); background: #14161bf0; border: 2px solid #d9c6a0; border-radius: 10px; padding: 14px 18px; pointer-events: auto; }
.tw-dialogue .speaker { color: #ffd98a; font-weight: bold; margin-bottom: 4px; }
.tw-dialogue .text { font-size: 18px; line-height: 1.4; min-height: 1.4em; }
.tw-dialogue .more { text-align: right; font-size: 12px; opacity: .7; margin-top: 6px; }
.tw-choices { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.tw-choice { padding: 5px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
.tw-choice.on { background: #2b3350; border-color: #6aa8ff; }
.tw-menu { position: absolute; inset: 0; background: #05060ccc; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.tw-panel { width: min(88%, 560px); max-height: 86%; overflow: auto; background: #14161b; border: 2px solid #d9c6a0; border-radius: 12px; padding: 18px 22px; }
.tw-panel h2 { margin: 0 0 12px; font-size: 22px; font-weight: normal; color: #ffd98a; }
.tw-row { display: flex; justify-content: space-between; gap: 14px; padding: 7px 12px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
.tw-row.on { background: #2b3350; border-color: #6aa8ff; }
.tw-row .detail { opacity: .75; text-align: right; }
.tw-hint { margin-top: 12px; font-size: 12px; opacity: .7; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * The game's own interface, drawn over the canvas: hearts, quick slots, boss bars, messages, conversations and
 * choices, fades, and the pause menu (inventory, travel to lit lanterns, save and load, settings, controls).
 * Plain DOM with no framework, so the editor's Play and exported games use exactly the same thing.
 */
export class GameUi {
  private readonly root = el('div', 'tw-ui');
  private readonly hud = el('div', 'tw-hud');
  private readonly hearts = el('div', 'tw-hearts');
  private readonly slotsEl = el('div', 'tw-slots');
  private readonly bosses = el('div');
  private readonly toasts = el('div', 'tw-toasts');
  private readonly fade = el('div', 'tw-fade');
  private readonly skip = el('div', 'tw-skip');
  private dialogueEl: HTMLElement | null = null;
  private menuEl: HTMLElement | null = null;
  private readonly style = el('style');
  private screen: Screen = 'main';
  private focus = 0;
  private rows: Row[] = [];
  private message = '';
  private capturing: string | null = null;
  private lastTick = -1;
  private lastDraw = '';
  private pending = 0;
  private readonly toastList: { text: string; until: number }[] = [];
  private readonly offs: (() => void)[] = [];
  private slotCache: SlotInfo[] = [];

  /** Text in the player's language (as written when there is no translation). */
  private tr(text: string): string {
    return this.host.sim.assets.strings.t(text);
  }

  private fmt(template: string, values: Record<string, string | number>): string {
    return this.host.sim.assets.strings.fmt(template, values);
  }

  constructor(
    private readonly parent: HTMLElement,
    private readonly host: GameUiHost,
  ) {
    this.style.textContent = CSS;
    this.root.setAttribute('data-testid', 'tw-ui');
    this.hud.setAttribute('data-testid', 'tw-hud');
    this.hearts.setAttribute('data-testid', 'tw-hearts');
    this.hud.append(this.hearts, this.slotsEl, this.bosses);
    this.root.append(this.style, this.hud, this.toasts, this.fade, this.skip);
    parent.appendChild(this.root);
    const ev = host.sim.events;
    this.offs.push(
      ev.on('message', (e) => this.toast(this.tr(String(e.text ?? '')))),
      ev.on('item-given', (e) => e.amount && this.toast(this.fmt('Received {item}', { item: this.itemName(String(e.item)) }))),
      ev.on('item-used', (e) => this.toast(this.fmt('Used {item}', { item: this.itemName(String(e.item)) }))),
      ev.on('died', (e) => host.sim.world.get(Number(e.entity))?.tags.has('player') && this.toast(this.tr('You were defeated.'))),
    );
  }

  private itemName(id: string): string {
    return this.tr(this.host.sim.assets.items.get(id)?.name ?? id);
  }

  private toast(text: string): void {
    if (!text) return;
    this.toastList.push({ text, until: performance.now() + 3500 });
    if (this.toastList.length > 5) this.toastList.shift();
  }

  get menuOpen(): boolean {
    return this.host.sim.runtime.menuOpen;
  }

  openMenu(screen: Screen = 'main'): void {
    const r = this.host.sim.runtime;
    if (r.dialogue || r.cutscene) return;
    r.menuOpen = true;
    this.go(screen);
  }

  closeMenu(): void {
    this.host.sim.runtime.menuOpen = false;
    this.menuEl?.remove();
    this.menuEl = null;
    this.capturing = null;
    this.lastDraw = '';
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.focus = 0;
    this.message = '';
    if (screen === 'save' || screen === 'load') void this.refreshSlots();
  }

  private async refreshSlots(): Promise<void> {
    this.slotCache = await this.host.slots();
    this.lastDraw = '';
  }

  /** Call once per animation frame. */
  update(): void {
    const sim = this.host.sim;
    const r = sim.runtime;
    // buttons: once per simulation tick
    if (sim.tick !== this.lastTick) {
      this.lastTick = sim.tick;
      this.handleInput();
    }
    this.drawHud();
    this.drawDialogue();
    this.drawMenu();
    this.fade.style.opacity = String(r.view.fade.alpha);
    this.fade.style.background = hex(r.view.fade.color);
    this.skip.textContent = r.cutscene && sim.assets.cutscenes.get(r.cutscene.name)?.skippable ? this.tr('P / Start: skip') : '';
    const now = performance.now();
    while (this.toastList.length && this.toastList[0]!.until < now) this.toastList.shift();
    const sig = this.toastList.map((t) => t.text).join('|');
    if (this.toasts.dataset.sig !== sig) {
      this.toasts.dataset.sig = sig;
      this.toasts.replaceChildren(...this.toastList.map((t) => el('div', 'tw-toast', t.text)));
    }
  }

  private handleInput(): void {
    const sim = this.host.sim;
    const ui = sim.uiInput;
    if (!this.menuOpen) {
      if (sim.runtime.dialogue || sim.runtime.cutscene) return;
      if (ui.pressed('pause')) this.openMenu('main');
      else if (ui.pressed('inventory')) this.openMenu('inventory');
      else if (ui.pressed('map')) this.openMenu('travel');
      return;
    }
    if (this.capturing) return; // waiting for a key to bind
    if (ui.pressed('move_up')) this.focus = (this.focus - 1 + this.rows.length) % Math.max(1, this.rows.length);
    if (ui.pressed('move_down')) this.focus = (this.focus + 1) % Math.max(1, this.rows.length);
    if (ui.pressed('move_left')) this.rows[this.focus]?.adjust?.(-1);
    if (ui.pressed('move_right')) this.rows[this.focus]?.adjust?.(1);
    if (ui.pressed('interact')) this.rows[this.focus]?.run?.();
    if (ui.pressed('pause')) this.back();
  }

  private back(): void {
    if (this.screen === 'main') this.closeMenu();
    else this.go(this.screen === 'controls' ? 'settings' : 'main');
  }

  // ---------- HUD ----------

  private drawHud(): void {
    const sim = this.host.sim;
    const player = sim.world.withTag('player')[0];
    const h = player ? healthOf(player) : undefined;
    const sig = JSON.stringify([h?.hp, h?.max, quickSlots(sim.runtime.vars), carried(sim.runtime.vars), sim.world.withTag('boss').map((b) => healthOf(b)?.hp)]);
    if (sig === this.lastDraw && !this.menuEl) {
      /* nothing changed */
    }
    const key = `hud:${sig}`;
    if (this.hud.dataset.sig === key) return;
    this.hud.dataset.sig = key;
    this.hearts.replaceChildren();
    if (h) {
      this.hearts.setAttribute('aria-label', `Health ${h.hp} of ${h.max}`);
      for (let i = 0; i < Math.ceil(h.max); i++) {
        const full = i < Math.ceil(h.hp);
        this.hearts.appendChild(el('span', full ? 'full' : 'empty', full ? '♥' : '♡'));
      }
    }
    const slots = quickSlots(sim.runtime.vars);
    this.slotsEl.replaceChildren();
    const anyItem = slots.some(Boolean);
    if (anyItem) {
      slots.forEach((id, i) => {
        const s = el('div', 'tw-slot');
        s.setAttribute('data-testid', `tw-slot-${i + 1}`);
        s.appendChild(el('span', 'key', String(i + 1)));
        if (id) {
          const def = sim.assets.items.get(id);
          const gem = el('div', 'gem');
          gem.style.background = hex(def?.color ?? 0xcccccc);
          s.appendChild(gem);
          s.appendChild(el('span', 'count', String(sim.runtime.vars[`item:${id}`] ?? 0)));
          s.title = def?.name ?? id;
        }
        this.slotsEl.appendChild(s);
      });
    }
    this.bosses.replaceChildren();
    for (const b of sim.world.withTag('boss')) {
      const bh = healthOf(b);
      const active = (b.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? true) !== false;
      if (!bh || bh.dead || !active) continue;
      const box = el('div', 'tw-boss');
      box.setAttribute('data-testid', 'tw-boss');
      box.appendChild(el('span', '', b.name));
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${Math.max(0, (bh.hp / bh.max) * 100)}%`;
      bar.appendChild(fill);
      box.appendChild(bar);
      this.bosses.appendChild(box);
    }
  }

  // ---------- conversation ----------

  private drawDialogue(): void {
    const sim = this.host.sim;
    const d = sim.runtime.dialogue;
    if (!d) {
      this.dialogueEl?.remove();
      this.dialogueEl = null;
      return;
    }
    const sig = JSON.stringify(d);
    if (this.dialogueEl && this.dialogueEl.dataset.sig === sig) return;
    this.dialogueEl?.remove();
    const box = el('div', 'tw-dialogue');
    box.dataset.sig = sig;
    box.setAttribute('data-testid', 'tw-dialogue');
    const speaker = d.view.speaker;
    if (speaker) box.appendChild(el('div', 'speaker', speaker));
    if (d.view.kind === 'line') {
      const t = el('div', 'text', d.view.text);
      t.setAttribute('data-testid', 'tw-dialogue-text');
      box.appendChild(t);
      box.appendChild(el('div', 'more', this.tr('E / click: continue')));
      box.onclick = () => confirmDialogue(contextOf(sim));
    } else {
      if (d.view.prompt) {
        const t = el('div', 'text', d.view.prompt);
        t.setAttribute('data-testid', 'tw-dialogue-text');
        box.appendChild(t);
      }
      const list = el('div', 'tw-choices');
      d.view.options.forEach((o, i) => {
        const c = el('div', `tw-choice${i === d.selected ? ' on' : ''}`, o.text);
        c.setAttribute('data-testid', `tw-choice-${i}`);
        c.onclick = (ev) => {
          ev.stopPropagation();
          selectChoice(contextOf(sim), 0, i);
          confirmDialogue(contextOf(sim));
        };
        list.appendChild(c);
      });
      box.appendChild(list);
    }
    this.root.appendChild(box);
    this.dialogueEl = box;
  }

  // ---------- menu ----------

  private buildRows(): { title: string; hint: string } {
    const h = this.host;
    const sim = h.sim;
    const rows: Row[] = [];
    let title = 'Paused';
    let hint = 'W / S to choose, E to select, Esc or P to go back';
    switch (this.screen) {
      case 'main':
        rows.push({ label: 'Resume', run: () => this.closeMenu(), testId: 'resume' });
        rows.push({ label: 'Inventory', run: () => this.go('inventory'), testId: 'inventory' });
        rows.push({ label: 'Travel to a lit lantern', detail: this.fmt('{n} lit', { n: litPosts(sim.runtime.vars).length }), run: () => this.go('travel'), testId: 'travel' });
        rows.push({ label: 'Save game', run: () => this.go('save'), testId: 'save' });
        rows.push({ label: 'Load game', run: () => this.go('load'), testId: 'load' });
        rows.push({ label: 'Settings', run: () => this.go('settings'), testId: 'settings' });
        rows.push({
          label: 'Restart this area',
          run: () => {
            this.closeMenu();
            h.restart();
          },
          testId: 'restart',
        });
        if (h.quit) rows.push({ label: 'Quit', run: () => h.quit?.(), testId: 'quit' });
        break;
      case 'inventory': {
        title = 'Inventory';
        const items = carried(sim.runtime.vars);
        if (items.length === 0) rows.push({ label: 'You are carrying nothing.' });
        for (const [id, n] of items) {
          const def = sim.assets.items.get(id);
          const slot = quickSlots(sim.runtime.vars).indexOf(id);
          rows.push({
            label: `${this.itemName(id)} x${n}`,
            detail: [this.tr(def?.description ?? ''), def?.use ? this.tr('press E to use') : '', slot >= 0 ? this.fmt('slot {n}', { n: slot + 1 }) : ''].filter(Boolean).join(' - '),
            run: () => {
              if (def?.use && useItem(contextOf(sim), id)) this.lastDraw = '';
            },
            adjust: (d) => {
              const next = ((slot + d + 1 + 5) % 5) - 1; // -1 = no slot, then 0..3
              const vars = sim.runtime.vars;
              for (let i = 1; i <= 4; i++) if (vars[`slot:${i}`] === id) vars[`slot:${i}`] = '';
              if (next >= 0) vars[`slot:${next + 1}`] = id;
            },
            testId: `item-${id}`,
          });
        }
        hint = 'E: use   A / D: choose its quick slot   Esc: back';
        break;
      }
      case 'travel': {
        title = 'Travel to a lit lantern';
        const posts = litPosts(sim.runtime.vars);
        if (posts.length === 0) rows.push({ label: 'No lanterns lit yet. Light one by pressing E beside it.' });
        for (const p of posts) {
          rows.push({
            label: p.name,
            detail: p.scene ? p.scene.replace(/^.*\//, '').replace('.scene.json', '') : 'this area',
            run: () => {
              this.closeMenu();
              h.travelTo(p);
            },
            testId: `post-${p.id}`,
          });
        }
        break;
      }
      case 'save':
      case 'load': {
        const saving = this.screen === 'save';
        title = saving ? 'Save game' : 'Load game';
        for (const s of this.slotCache) {
          if (saving && s.slot === 'autosave') continue;
          rows.push({
            label: s.slot === 'autosave' ? 'Autosave' : this.fmt('Slot {n}', { n: s.slot.replace('slot', '') }),
            detail: s.damaged ? 'damaged' : s.exists ? [s.label, s.savedAt.slice(0, 16).replace('T', ' ')].filter(Boolean).join(' - ') : 'empty',
            run: () => {
              if (!saving && !s.exists) return;
              void (saving ? h.saveTo(s.slot) : h.loadFrom(s.slot)).then(async (msg) => {
                this.message = msg;
                if (!saving) this.closeMenu();
                else await this.refreshSlots();
                this.toast(msg);
              });
            },
            testId: `slot-${s.slot}`,
          });
        }
        break;
      }
      case 'settings': {
        title = 'Settings';
        const set = h.settings;
        const slider = (label: string, key: 'master' | 'music' | 'sfx'): Row => ({
          label,
          detail: `${Math.round(set[key] * 100)}%`,
          adjust: (d) => h.changeSettings({ [key]: Math.min(1, Math.max(0, Math.round((set[key] + d * 0.1) * 10) / 10)) }),
          run: () => h.changeSettings({ [key]: set[key] > 0 ? 0 : 0.8 }),
          testId: `set-${key}`,
        });
        rows.push(slider('Master volume', 'master'), slider('Music volume', 'music'), slider('Effects volume', 'sfx'));
        const levels: GameSettings['difficulty'][] = ['easy', 'normal', 'hard'];
        const cycle = (d: number): void => {
          const next = levels[(levels.indexOf(set.difficulty) + d + 3) % 3]!;
          h.changeSettings({ difficulty: next });
          sim.runtime.difficulty = next;
        };
        rows.push({ label: 'Difficulty', detail: set.difficulty, adjust: cycle, run: () => cycle(1), testId: 'set-difficulty' });
        rows.push({ label: 'Screen shake and hit freeze', detail: set.screenShake ? 'on' : 'off', run: () => h.changeSettings({ screenShake: !set.screenShake }), adjust: () => h.changeSettings({ screenShake: !set.screenShake }), testId: 'set-shake' });
        const zooms = [0.75, 1, 1.25, 1.5];
        const zoom = (d: number): void => {
          const at = zooms.findIndex((z) => Math.abs(z - set.cameraZoom) < 0.01);
          h.changeSettings({ cameraZoom: zooms[(Math.max(at, 1) + d + zooms.length) % zooms.length]! });
        };
        rows.push({ label: 'Camera zoom', detail: `${Math.round(set.cameraZoom * 100)}%`, adjust: zoom, run: () => zoom(1), testId: 'set-zoom' });
        const full = h.fullscreen;
        if (full) {
          const toggle = (): void => {
            const on = !full.get();
            full.set(on);
            h.changeSettings({ fullscreen: on });
          };
          rows.push({ label: 'Full screen', detail: full.get() ? 'on' : 'off', run: toggle, adjust: toggle, testId: 'set-fullscreen' });
        }
        rows.push({ label: 'Show frame rate', detail: set.showFps ? 'on' : 'off', run: () => h.changeSettings({ showFps: !set.showFps }), adjust: () => h.changeSettings({ showFps: !set.showFps }), testId: 'set-fps' });
        const skins = availableSkins(sim.assets.skins, sim.runtime.vars);
        if (skins.length > 0) {
          const looks = [{ id: '', name: 'Original' }, ...skins.map((s) => ({ id: s.id, name: s.name }))];
          const pick = (d: number): void => {
            const at = Math.max(0, looks.findIndex((l) => l.id === set.skin));
            h.changeSettings({ skin: looks[(at + d + looks.length) % looks.length]!.id });
          };
          rows.push({ label: 'Appearance', detail: looks.find((l) => l.id === set.skin)?.name ?? 'Original', adjust: pick, run: () => pick(1), testId: 'set-skin' });
        }
        const languages = languageChoices(sim.assets.strings);
        if (languages.length > 1) {
          const lang = (d: number): void => {
            const next = languages[(languages.findIndex((l) => l.code === set.language) + d + languages.length) % languages.length]!;
            h.changeSettings({ language: next.code });
          };
          // each language is shown by its own name, so a player who cannot read the current one can still find theirs
          rows.push({ label: 'Language', detail: languages.find((l) => l.code === set.language)?.name ?? languages[0]!.name, adjust: lang, run: () => lang(1), testId: 'set-language' });
        }
        rows.push({ label: 'Controls', run: () => this.go('controls'), testId: 'set-controls' });
        break;
      }
      case 'controls': {
        title = 'Controls';
        const b = h.bindings();
        for (const action of Object.keys(ACTION_LABELS)) {
          rows.push({
            label: ACTION_LABELS[action]!,
            detail: this.capturing === action ? 'press a key or button...' : (b[action] ?? []).map(bindingLabel).join(', ') || 'not set',
            run: () => {
              this.capturing = action;
              this.lastDraw = '';
              void h.captureNext().then((id) => {
                this.capturing = null;
                if (id) h.rebind(action, id);
                this.lastDraw = '';
              });
            },
            testId: `bind-${action}`,
          });
        }
        rows.push({ label: 'Reset all controls', run: () => h.resetBindings(), testId: 'bind-reset' });
        hint = 'E: change the selected control, then press the new key or button';
        break;
      }
    }
    this.rows = rows;
    return { title, hint };
  }

  private drawMenu(): void {
    if (!this.menuOpen) {
      if (this.menuEl) this.closeMenu();
      return;
    }
    const { title, hint } = this.buildRows();
    this.focus = Math.min(this.focus, Math.max(0, this.rows.length - 1));
    const sig = JSON.stringify([this.screen, this.focus, this.rows.map((r) => [r.label, r.detail]), this.message, this.capturing, this.host.sim.assets.strings.language]);
    if (this.menuEl && this.menuEl.dataset.sig === sig) return;
    this.menuEl?.remove();
    const wrap = el('div', 'tw-menu');
    wrap.dataset.sig = sig;
    wrap.setAttribute('data-testid', 'tw-menu');
    const panel = el('div', 'tw-panel');
    panel.appendChild(el('h2', '', this.tr(title)));
    this.rows.forEach((r, i) => {
      const row = el('div', `tw-row${i === this.focus ? ' on' : ''}`);
      row.appendChild(el('span', '', this.tr(r.label)));
      if (r.detail) row.appendChild(el('span', 'detail', this.tr(r.detail)));
      if (r.testId) row.setAttribute('data-testid', `tw-row-${r.testId}`);
      row.onclick = () => {
        this.focus = i;
        r.run?.();
      };
      panel.appendChild(row);
    });
    if (this.message) panel.appendChild(el('div', 'tw-hint', this.tr(this.message)));
    panel.appendChild(el('div', 'tw-hint', this.tr(hint)));
    wrap.appendChild(panel);
    this.root.appendChild(wrap);
    this.menuEl = wrap;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.root.remove();
    this.host.sim.runtime.menuOpen = false;
    void this.pending;
  }
}
