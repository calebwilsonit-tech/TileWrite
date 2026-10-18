import {
  ACTION_LABELS,
  availableSkins,
  completeLayout,
  defaultUiLayout,
  fillVariables,
  themeVars,
  widgetCss,
  type UiLayout,
  type UiWidget,
  MAP_HEIGHT,
  MAP_WIDTH,
  neighbourInDirection,
  placeState,
  bindingLabel,
  carried,
  languageChoices,
  parseRichText,
  quickSlots,
  type GameSettings,
  RESERVED_SCREENS,
  compositeFrame,
  backScreen,
  closeScreen,
  openScreen,
  openStartScreens,
  screenNamed,
  topScreen,
  type InputMapDef,
  type SlotInfo,
  type Simulation,
} from '@tilewright/runtime';
import { healthOf } from '../builtins/combat';
import { litPosts, type LitPost } from '../builtins/story';
import { contextOf } from '../story/context';
import { confirmDialogue, selectChoice } from '../story/director';
import { useItem } from '../story/inventory';
import { MINIGAME_CSS, MINIGAME_STRINGS, MinigameView } from './minigame-ui';
import { SCREENS_CSS, UiScreens } from './screens-dom';
import { setUiBridge } from './screens-logic';

/** What the screens need from whoever is running the game (the editor's Play, or an exported game). */
export interface GameUiHost {
  sim: Simulation;
  settings: GameSettings;
  bindings(): InputMapDef;
  /** Names of the actions for the Controls screen (the game's own actions included); default: the built-in ones. */
  actionLabels?(): Record<string, string>;
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
  /** Go to a scene (and a spawn point in it: an object's name or "x,y"; '' = its player start). */
  travelToScene(scene: string, spawn: string): void;
  quit?(): void;
  /** Full screen on and off; only a game running in its own window can offer it. */
  fullscreen?: { get(): boolean; set(on: boolean): void };
  /** A sprite's first picture as an image address, for image widgets. */
  spriteUrl?(name: string): string | null;
}

/**
 * Every fixed piece of text in the game's own screens. The translation tables list these so a language can cover the
 * menus too; `{name}`-style parts are filled in after translating. (A test keeps this list complete.)
 */
export const UI_STRINGS: readonly string[] = [
  ...MINIGAME_STRINGS,
  'Paused', 'Resume', 'New game', 'Continue', 'Inventory', 'Travel to a lit lantern', 'Save game', 'Load game', 'Settings', 'Restart this area', 'Quit',
  '{n} lit', 'You are carrying nothing.', 'press E to use', 'slot {n}', 'E: use   A / D: choose its quick slot   Esc: back',
  'No lanterns lit yet. Light one by pressing E beside it.', 'this area', 'Autosave', 'Slot {n}', 'damaged', 'empty',
  'Map', 'you are here', 'Arrows or W A S D: choose a place   E or click: travel   Esc: back', 'Nowhere to go yet.',
  'Master volume', 'Music volume', 'Effects volume', 'Voice volume', 'Difficulty', 'easy', 'normal', 'hard', 'Screen shake and hit freeze', 'on', 'off',
  'Camera zoom', 'Full screen', 'Show frame rate', 'Appearance', 'Original', 'Language', 'Default', 'Controls', 'press a key or button...', 'not set', 'Reset all controls',
  'E: change the selected control, then press the new key or button', 'W / S to choose, E to select, Esc or P to go back', 'W / S to choose, E to select',
  'E / click: continue', 'P / Start: skip', 'Received {item}', 'Used {item}', 'You were defeated.',
  'Echo made.', 'You cannot make echoes yet.', 'Recording... press Echo again to finish.',
  '{name} is lit.', 'Rested at {name}.', '{name} gets angry!', '{name} is defeated!',
];

/** Every fixed text of the game's screens, including the names of the controls. */
export const uiStrings = (): string[] => [...new Set([...UI_STRINGS, ...Object.values(ACTION_LABELS)])];

/** What the title screen shows (the game's name and a line under it). */
export interface TitleInfo {
  text: string;
  subtitle: string;
}

type Screen = 'title' | 'main' | 'inventory' | 'travel' | 'map' | 'save' | 'load' | 'settings' | 'controls';

const MAP_GLYPHS: Record<string, string> = { pin: '\u25CF', town: '\u2302', dungeon: '\u2620', cave: '\u25D3', forest: '\u2663', tower: '\u265C', castle: '\u265B', camp: '\u25B2', harbor: '\u2693' };

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
.tw-ui { position: absolute; inset: 0; pointer-events: none; font-family: var(--tw-font, Georgia, 'Times New Roman', serif); color: var(--tw-text, #f4efe6); user-select: none; }
.tw-ui * { box-sizing: border-box; }
.tw-hud { position: absolute; top: 10px; left: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; text-shadow: 0 1px 3px #000; }
.tw-hearts { font-size: 22px; letter-spacing: 3px; }
.tw-hearts .full { color: #ff5d6c; } .tw-hearts .empty { color: #8a8f9c; }
.tw-lightbar { width: 160px; height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; display: none; }
.tw-lightbar .fill { height: 100%; background: linear-gradient(90deg, #d9a21a, #ffe27a); }
.tw-lightbar.low .fill { background: linear-gradient(90deg, #8a3a1a, #d9701a); }
.tw-slots { display: flex; gap: 6px; }
.tw-slot { width: 44px; height: 44px; border: 2px solid #ffffff55; border-radius: min(var(--tw-radius, 10px), 14px); background: color-mix(in srgb, var(--tw-panel, #14161b) 80%, transparent); display: flex; align-items: center; justify-content: center; position: relative; font-size: 11px; }
.tw-slot .key { position: absolute; top: 1px; left: 4px; opacity: .7; }
.tw-slot .count { position: absolute; bottom: 1px; right: 4px; }
.tw-slot .gem { width: 20px; height: 20px; border-radius: 5px; }
.tw-boss { align-self: center; width: min(60%, 480px); text-align: center; font-size: 13px; }
.tw-boss .bar { height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; margin-top: 3px; }
.tw-boss .fill { height: 100%; background: linear-gradient(90deg, #b3366e, #e0566b); }
.tw-toasts { position: absolute; right: 14px; bottom: 14px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.tw-toast { background: color-mix(in srgb, var(--tw-panel, #14161b) 87%, transparent); border-left: 4px solid var(--tw-highlight, #6aa8ff); padding: 7px 12px; border-radius: min(var(--tw-radius, 10px), 8px); font-size: 14px; }
.tw-fade { position: absolute; inset: 0; background: #000; opacity: 0; }
.tw-skip { position: absolute; top: 12px; right: 16px; font-size: 12px; opacity: .75; text-shadow: 0 1px 3px #000; }
.tw-dialogue { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%) scale(var(--tw-scale, 1)); transform-origin: bottom center; width: min(80%, 760px); background: color-mix(in srgb, var(--tw-panel, #14161b) 94%, transparent); border: 2px solid var(--tw-border, #d9c6a0); border-radius: var(--tw-radius, 10px); padding: 14px 18px; pointer-events: auto; }
.tw-dialogue .speaker { color: var(--tw-accent, #ffd98a); font-weight: bold; margin-bottom: 4px; }
.tw-dialogue .text { font-size: 18px; line-height: 1.4; min-height: 1.4em; }
.tw-dialogue .more { text-align: right; font-size: 12px; opacity: .7; margin-top: 6px; }
.tw-choices { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.tw-choice { padding: 5px 10px; border-radius: min(var(--tw-radius, 10px), 8px); cursor: pointer; border: 1px solid transparent; }
.tw-choice.on { background: color-mix(in srgb, var(--tw-highlight, #6aa8ff) 25%, var(--tw-panel, #14161b)); border-color: var(--tw-highlight, #6aa8ff); }
.tw-menu { position: absolute; inset: 0; background: #05060ccc; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.tw-panel { width: min(88%, 560px); max-height: 86%; overflow: auto; zoom: var(--tw-scale, 1); background: var(--tw-panel, #14161b); border: 2px solid var(--tw-border, #d9c6a0); border-radius: calc(var(--tw-radius, 10px) + 2px); padding: 18px 22px; }
.tw-panel h2 { margin: 0 0 12px; font-size: 22px; font-weight: normal; color: var(--tw-accent, #ffd98a); }
.tw-row { display: flex; justify-content: space-between; gap: 14px; padding: 7px 12px; border-radius: min(var(--tw-radius, 10px), 8px); cursor: pointer; border: 1px solid transparent; }
.tw-row.on { background: color-mix(in srgb, var(--tw-highlight, #6aa8ff) 25%, var(--tw-panel, #14161b)); border-color: var(--tw-highlight, #6aa8ff); }
.tw-row .detail { opacity: .75; text-align: right; }
.tw-hint { margin-top: 12px; font-size: 12px; opacity: .7; }
.tw-panel.wide { width: min(94%, 920px); }
.tw-menu.front { background: radial-gradient(ellipse at center, #1b2030f2, #05060cf8); }
.tw-game-title { margin: 6px 0 4px; font-size: 40px; font-weight: normal; color: var(--tw-accent, #ffd98a); text-align: center; letter-spacing: .04em; }
.tw-subtitle { text-align: center; opacity: .8; margin-bottom: 16px; }
.tw-hidden { display: none !important; }
.tw-tint { position: absolute; inset: 0; pointer-events: none; display: none; mix-blend-mode: multiply; }
.tw-selectbox { position: absolute; border: 1px solid #7dffb2; background: #7dffb222; display: none; pointer-events: none; }
.tw-bosses[data-pinned] .tw-boss { width: 320px; }
.tw-widget { text-shadow: 0 1px 3px #000; font-size: 15px; }
.tw-widget .label { margin-right: 6px; opacity: .85; }
.tw-widget .track { width: 160px; height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; margin-top: 3px; }
.tw-widget .track .fill { height: 100%; }
.tw-map { width: 100%; height: auto; display: block; margin-bottom: 10px; border-radius: 8px; border: 1px solid #d9c6a055; background: #2a2418; }
.tw-map .place { cursor: pointer; } .tw-map .place text { pointer-events: none; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** An element holding text with inline formatting ([b], [i], [u], [s], [color=...]) as spans; never parsed as HTML. */
const rich = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text: string): HTMLElementTagNameMap[K] => {
  const e = el(tag, cls);
  for (const s of parseRichText(text)) {
    if (!s.bold && !s.italic && !s.underline && !s.strike && !s.color) {
      e.appendChild(document.createTextNode(s.text));
      continue;
    }
    const span = document.createElement('span');
    span.textContent = s.text;
    if (s.bold) span.style.fontWeight = 'bold';
    if (s.italic) span.style.fontStyle = 'italic';
    if (s.underline || s.strike) span.style.textDecoration = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    if (s.color) span.style.color = s.color;
    e.appendChild(span);
  }
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
  private readonly lightBar = el('div', 'tw-lightbar');
  private readonly slotsEl = el('div', 'tw-slots');
  private readonly bosses = el('div', 'tw-bosses');
  private readonly toasts = el('div', 'tw-toasts');
  private readonly fade = el('div', 'tw-fade');
  private readonly skip = el('div', 'tw-skip');
  /** The rectangle being dragged to select units. */
  private readonly selectBox = el('div', 'tw-selectbox');
  /** Night and dusk: a colour over the picture. */
  private readonly tint = el('div', 'tw-tint');
  private dialogueEl: HTMLElement | null = null;
  private layout: UiLayout = defaultUiLayout();
  /** The game's own counters, bars and texts, by name. */
  private readonly widgetEls = new Map<string, HTMLElement>();
  /** Inline styles put on a piece by the layout, so the next layout can take them off again. */
  private readonly applied = new Map<HTMLElement, string[]>();
  private readonly minigame: MinigameView;
  /** The screens made in the UI designer (assets/screens.json). */
  readonly screens: UiScreens;
  private menuEl: HTMLElement | null = null;
  private readonly style = el('style');
  private screen: Screen = 'main';
  /** Set while the title screen is the game's front door: the pause keys cannot close it. */
  private titleInfo: TitleInfo | null = null;
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
    this.style.textContent = CSS + MINIGAME_CSS + SCREENS_CSS;
    this.minigame = new MinigameView(this.root, host.sim);
    this.screens = new UiScreens(this.root, host.sim);
    setUiBridge(host.sim, {
      getSetting: (k) => (host.settings as Record<string, unknown>)[k] as never,
      setSetting: (k, v) => host.changeSettings({ [k]: v } as Partial<GameSettings>),
      rebind: (action) => {
        void host.captureNext().then((id) => {
          if (id) host.rebind(action, id);
          this.screens.captured();
        });
      },
      bindingText: (action) => (host.bindings()[action] ?? []).map((b) => bindingLabel(b)).join(' / '),
      spriteUrl: (name) => host.spriteUrl?.(name) ?? this.spriteFrameUrl(name),
    });
    this.root.setAttribute('data-testid', 'tw-ui');
    this.hud.setAttribute('data-testid', 'tw-hud');
    this.hearts.setAttribute('data-testid', 'tw-hearts');
    this.lightBar.setAttribute('data-testid', 'tw-lightbar');
    this.hud.append(this.hearts, this.lightBar, this.slotsEl, this.bosses);
    this.selectBox.setAttribute('data-testid', 'tw-selectbox');
    this.root.prepend(this.tint);
    this.root.append(this.style, this.hud, this.toasts, this.fade, this.skip, this.selectBox);
    parent.appendChild(this.root);
    this.setLayout(defaultUiLayout());
    const ev = host.sim.events;
    this.offs.push(
      ev.on('message', (e) => this.toast(this.tr(String(e.text ?? '')))),
      ev.on('item-given', (e) => e.amount && this.toast(this.fmt('Received {item}', { item: this.itemName(String(e.item)) }))),
      ev.on('item-used', (e) => this.toast(this.fmt('Used {item}', { item: this.itemName(String(e.item)) }))),
      ev.on('died', (e) => host.sim.world.get(Number(e.entity))?.tags.has('player') && this.toast(this.tr('You were defeated.'))),
    );
  }

  private readonly spriteUrls = new Map<string, string>();

  /** The first picture of a sprite as an image address (for image widgets). */
  private spriteFrameUrl(name: string): string | null {
    const cached = this.spriteUrls.get(name);
    if (cached !== undefined) return cached;
    const sprite = this.host.sim.assets.sprites.get(name);
    if (!sprite) return null;
    try {
      const rgba = compositeFrame(sprite, 0);
      const canvas = document.createElement('canvas');
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), sprite.width, sprite.height), 0, 0);
      const url = canvas.toDataURL('image/png');
      this.spriteUrls.set(name, url);
      return url;
    } catch {
      return null;
    }
  }

  private itemName(id: string): string {
    return this.tr(this.host.sim.assets.items.get(id)?.name ?? id);
  }

  private toast(text: string): void {
    if (!text) return;
    this.toastList.push({ text, until: performance.now() + 3500 });
    if (this.toastList.length > 5) this.toastList.shift();
  }

  /** Use this theme and arrangement of the heads-up display. */
  setLayout(layout: UiLayout): void {
    this.layout = completeLayout(layout);
    for (const [k, v] of Object.entries(themeVars(this.layout.theme))) this.root.style.setProperty(k, v);
    const builtin: Record<string, HTMLElement> = { hearts: this.hearts, lightbar: this.lightBar, slots: this.slotsEl, bosses: this.bosses, toasts: this.toasts };
    const wanted = new Set<string>();
    const flow: HTMLElement[] = [];
    for (const w of this.layout.widgets) {
      let target = builtin[w.kind];
      if (!target) {
        wanted.add(w.id);
        target = this.widgetEls.get(w.id);
        if (!target) {
          target = el('div', 'tw-widget');
          target.setAttribute('data-testid', `tw-widget-${w.id}`);
          this.widgetEls.set(w.id, target);
        }
        target.dataset.kind = w.kind;
        target.dataset.sig = '';
      }
      this.place(target, w);
      if (w.anchor === 'default' && w.kind !== 'toasts') flow.push(target);
      else if (target.parentElement !== this.root) this.root.appendChild(target);
    }
    // pieces on the default anchor stay in the column at the top left, in a fixed order
    const order: HTMLElement[] = [this.hearts, this.lightBar, this.slotsEl, this.bosses];
    flow.sort((a, b) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99));
    for (const f of flow) this.hud.appendChild(f);
    if (this.toasts.parentElement !== this.root) this.root.appendChild(this.toasts);
    for (const [id, e] of this.widgetEls) {
      if (!wanted.has(id)) {
        e.remove();
        this.widgetEls.delete(id);
      }
    }
    this.hud.dataset.sig = '';
  }

  private place(target: HTMLElement, w: UiWidget): void {
    for (const k of this.applied.get(target) ?? []) target.style.removeProperty(k);
    const css = widgetCss(w, this.layout.theme.scale);
    for (const [k, v] of Object.entries(css)) target.style.setProperty(k, v);
    this.applied.set(target, Object.keys(css));
    target.classList.toggle('tw-hidden', !w.visible);
    if (target === this.bosses) {
      if (w.anchor === 'default') delete target.dataset.pinned;
      else target.dataset.pinned = '1';
    }
  }

  /** The game's own counters, bars and texts. */
  private drawWidgets(): void {
    const vars = this.host.sim.runtime.vars;
    for (const w of this.layout.widgets) {
      if (w.kind !== 'counter' && w.kind !== 'bar' && w.kind !== 'text') continue;
      const e = this.widgetEls.get(w.id);
      if (!e || !w.visible) continue;
      const value = Number(vars[w.variable]) || 0;
      const max = w.maxVariable ? Number(vars[w.maxVariable]) || 1 : w.max;
      const sig = w.kind === 'text' ? fillVariables(this.tr(w.text), vars) : JSON.stringify([w.label, value, max, w.color]);
      if (e.dataset.sig === sig) continue;
      e.dataset.sig = sig;
      e.replaceChildren();
      if (w.kind === 'text') e.appendChild(rich('span', '', sig));
      else {
        const line = el('div');
        if (w.label) line.appendChild(rich('span', 'label', this.tr(w.label)));
        if (w.kind === 'counter') line.appendChild(el('span', 'value', String(Math.round(value * 100) / 100)));
        e.appendChild(line);
        if (w.kind === 'bar') {
          const track = el('div', 'track');
          const fill = el('div', 'fill');
          fill.style.width = `${Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))}%`;
          fill.style.background = w.color;
          track.appendChild(fill);
          e.appendChild(track);
        }
      }
    }
  }

  /** A menu or a screen that freezes the game is open. */
  get menuOpen(): boolean {
    return this.host.sim.runtime.menuOpen || this.host.sim.runtime.ui.modal;
  }

  /** The built-in pause menu / title is the one showing. */
  private get builtinOpen(): boolean {
    return this.host.sim.runtime.menuOpen;
  }

  private hasScreen(name: string): boolean {
    return screenNamed(this.host.sim.assets, name) !== undefined;
  }

  openMenu(screen: Screen = 'main'): void {
    const r = this.host.sim.runtime;
    if (r.dialogue || r.cutscene || r.minigame) return;
    // a Pause screen made in the designer replaces the built-in menu
    if (screen === 'main' && this.hasScreen(RESERVED_SCREENS.pause)) {
      openScreen(this.host.sim, RESERVED_SCREENS.pause);
      return;
    }
    r.menuOpen = true;
    this.go(screen);
  }

  /** Show the title screen (New game, Continue, Load game, Settings, Quit); the world waits behind it. */
  openTitle(info: TitleInfo): void {
    this.titleInfo = info;
    if (this.hasScreen(RESERVED_SCREENS.title)) {
      openScreen(this.host.sim, RESERVED_SCREENS.title);
      return;
    }
    this.host.sim.runtime.menuOpen = true;
    this.go('title');
  }

  get titleOpen(): boolean {
    return this.titleInfo !== null;
  }

  /** Open the screens that open when the game starts (a title screen, a heads-up display). */
  openStart(): void {
    openStartScreens(this.host.sim);
  }

  closeMenu(): void {
    this.titleInfo = null;
    this.host.sim.runtime.menuOpen = false;
    this.menuEl?.remove();
    this.menuEl = null;
    this.capturing = null;
    this.lastDraw = '';
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.focus = screen === 'map' ? Math.max(0, this.mapPlaces().findIndex((p) => p.state === 'here')) : 0;
    this.message = '';
    if (screen === 'save' || screen === 'load' || screen === 'title') void this.refreshSlots();
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
    this.screens.update();
    if (this.titleInfo && this.hasScreen(RESERVED_SCREENS.title) && !r.ui.stack.includes(RESERVED_SCREENS.title)) this.titleInfo = null;
    this.drawHud();
    this.drawWidgets();
    this.drawDialogue();
    this.minigame.update();
    this.drawMenu();
    const tint = r.view.tint;
    if (tint) Object.assign(this.tint.style, { display: 'block', background: hex(tint.color), opacity: String(Math.min(0.85, tint.alpha)) });
    else if (this.tint.style.display !== 'none') this.tint.style.display = 'none';
    const box = r.view.selectBox;
    if (box) {
      Object.assign(this.selectBox.style, { display: 'block', left: `${Math.min(box.x0, box.x1)}px`, top: `${Math.min(box.y0, box.y1)}px`, width: `${Math.abs(box.x1 - box.x0)}px`, height: `${Math.abs(box.y1 - box.y0)}px` });
    } else if (this.selectBox.style.display !== 'none') this.selectBox.style.display = 'none';
    this.fade.style.opacity = String(r.view.fade.alpha);
    this.fade.style.background = hex(r.view.fade.color);
    this.skip.textContent = r.cutscene && sim.assets.cutscenes.get(r.cutscene.name)?.skippable ? this.tr('P / Start: skip') : '';
    const now = performance.now();
    while (this.toastList.length && this.toastList[0]!.until < now) this.toastList.shift();
    const sig = this.toastList.map((t) => t.text).join('|');
    if (this.toasts.dataset.sig !== sig) {
      this.toasts.dataset.sig = sig;
      this.toasts.replaceChildren(...this.toastList.map((t) => rich('div', 'tw-toast', t.text)));
    }
  }

  private handleInput(): void {
    const sim = this.host.sim;
    const ui = sim.uiInput;
    // screens from the designer: the pause key opens Pause, or goes back from the screen on top
    const stack = sim.runtime.ui.stack;
    if (stack.length > 0 || this.hasScreen(RESERVED_SCREENS.pause)) {
      if (this.builtinOpen) return;
      const top = topScreen(sim);
      if (ui.pressed('pause') && !sim.runtime.dialogue && !sim.runtime.cutscene && !sim.runtime.minigame) {
        if (top?.modal && this.titleInfo === null) {
          if (top.name === RESERVED_SCREENS.pause) closeScreen(sim, top.name);
          else backScreen(sim);
        } else if (!top?.modal && this.hasScreen(RESERVED_SCREENS.pause)) openScreen(sim, RESERVED_SCREENS.pause);
        else if (!top?.modal) this.openMenu('main');
      }
      if (stack.length > 0 && sim.runtime.ui.modal) return;
    }
    if (!this.builtinOpen) {
      if (sim.runtime.dialogue || sim.runtime.cutscene || sim.runtime.minigame) return;
      if (ui.pressed('pause')) this.openMenu('main');
      else if (ui.pressed('inventory')) this.openMenu('inventory');
      else if (ui.pressed('map')) this.openMenu(sim.assets.worldMap && sim.assets.worldMap.nodes.length > 0 ? 'map' : 'travel');
      return;
    }
    if (this.capturing) return; // waiting for a key to bind
    if (this.screen === 'map') {
      const dir = ui.pressed('move_left') ? 'left' : ui.pressed('move_right') ? 'right' : ui.pressed('move_up') ? 'up' : ui.pressed('move_down') ? 'down' : null;
      if (dir) {
        const places = this.mapPlaces();
        const from = places[this.focus]?.node.id ?? '';
        const to = neighbourInDirection(places.map((p) => p.node), from, dir);
        const at = places.findIndex((p) => p.node.id === to);
        if (at >= 0) this.focus = at;
      }
      if (ui.pressed('interact')) this.rows[this.focus]?.run?.();
      if (ui.pressed('pause')) this.back();
      return;
    }
    if (ui.pressed('move_up')) this.focus = (this.focus - 1 + this.rows.length) % Math.max(1, this.rows.length);
    if (ui.pressed('move_down')) this.focus = (this.focus + 1) % Math.max(1, this.rows.length);
    if (ui.pressed('move_left')) this.rows[this.focus]?.adjust?.(-1);
    if (ui.pressed('move_right')) this.rows[this.focus]?.adjust?.(1);
    if (ui.pressed('interact')) this.rows[this.focus]?.run?.();
    if (ui.pressed('pause')) this.back();
  }

  /** The places of the world map the player can see and pick (open ones, and the one they are standing in). */
  private mapPlaces(): { node: import('@tilewright/runtime').MapNode; state: ReturnType<typeof placeState> }[] {
    const sim = this.host.sim;
    const map = sim.assets.worldMap;
    if (!map) return [];
    const posts = litPosts(sim.runtime.vars);
    const lit = (scene: string): boolean => posts.some((p) => p.scene === scene);
    return map.nodes.map((node) => ({ node, state: placeState(node, sim.runtime.vars, sim.runtime.scene, lit) })).filter((p) => p.state === 'open' || p.state === 'here');
  }

  private travelToPlace(node: import('@tilewright/runtime').MapNode): void {
    const sim = this.host.sim;
    this.closeMenu();
    // a place that unlocks with a lantern: arrive at its lit lantern
    const post = node.unlock.kind === 'lantern' ? litPosts(sim.runtime.vars).find((p) => p.scene === node.scene) : undefined;
    if (post) this.host.travelTo(post);
    else this.host.travelToScene(node.scene, node.spawn);
  }

  /** The picture of the map: places joined by paths, the one under the cursor ringed, locked ones as question marks. */
  private mapSvg(): SVGSVGElement {
    const sim = this.host.sim;
    const map = sim.assets.worldMap!;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
    svg.setAttribute('class', 'tw-map');
    svg.setAttribute('data-testid', 'tw-map');
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg): SVGElementTagNameMap[K] => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    const posts = litPosts(sim.runtime.vars);
    const lit = (scene: string): boolean => posts.some((p) => p.scene === scene);
    const state = new Map(map.nodes.map((n) => [n.id, placeState(n, sim.runtime.vars, sim.runtime.scene, lit)]));
    const shown = (id: string): boolean => (state.get(id) ?? 'hidden') !== 'hidden';
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    for (const l of map.links) {
      const a = byId.get(l.a);
      const b = byId.get(l.b);
      if (!a || !b || !shown(a.id) || !shown(b.id)) continue;
      make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#d9c6a0', 'stroke-width': 3, 'stroke-dasharray': '10 7', opacity: 0.6 });
    }
    const focused = this.mapPlaces()[this.focus]?.node.id;
    for (const n of map.nodes) {
      const st = state.get(n.id)!;
      if (st === 'hidden') continue;
      const g = make('g', { class: 'place', transform: `translate(${n.x},${n.y})`, 'data-testid': `tw-place-${n.id}`, 'data-state': st });
      if (n.id === focused) make('circle', { r: 30, fill: 'none', stroke: '#6aa8ff', 'stroke-width': 4 }, g);
      make('circle', { r: 22, fill: st === 'locked' ? '#3b3b44' : st === 'here' ? '#2b4c7e' : '#4a3b1e', stroke: st === 'locked' ? '#777' : '#ffd98a', 'stroke-width': 3 }, g);
      const glyph = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 22, fill: st === 'locked' ? '#999' : '#ffd98a' }, g);
      glyph.textContent = st === 'locked' ? '?' : (MAP_GLYPHS[n.icon] ?? MAP_GLYPHS.pin!);
      const label = make('text', { 'text-anchor': 'middle', y: 42, 'font-size': 20, fill: st === 'locked' ? '#999' : '#f4efe6' }, g);
      label.textContent = st === 'locked' ? '?' : this.tr(n.label);
      if (st === 'here') {
        const you = make('text', { 'text-anchor': 'middle', y: -34, 'font-size': 15, fill: '#9cc7ff' }, g);
        you.textContent = this.tr('you are here');
      }
      const index = this.mapPlaces().findIndex((p) => p.node.id === n.id);
      if (index >= 0) {
        g.addEventListener('click', () => {
          this.focus = index;
          this.rows[index]?.run?.();
        });
      }
    }
    return svg;
  }

  private back(): void {
    if (this.screen === 'title') return;
    if (this.screen === 'main') this.closeMenu();
    else this.go(this.screen === 'controls' ? 'settings' : this.titleInfo ? 'title' : 'main');
  }

  // ---------- HUD ----------

  private drawHud(): void {
    const sim = this.host.sim;
    const player = sim.world.withTag('player')[0];
    const h = player ? healthOf(player) : undefined;
    const lantern = player?.has('lightResource') ? Math.round(((Number(sim.runtime.vars.light) || 0) / Math.max(1, Number(sim.runtime.vars.lightMax) || 100)) * 100) : null;
    const sig = JSON.stringify([h?.hp, h?.max, lantern, quickSlots(sim.runtime.vars), carried(sim.runtime.vars), sim.world.withTag('boss').map((b) => healthOf(b)?.hp)]);
    if (sig === this.lastDraw && !this.menuEl) {
      /* nothing changed */
    }
    const key = `hud:${sig}`;
    if (this.hud.dataset.sig === key) return;
    this.hud.dataset.sig = key;
    this.lightBar.replaceChildren();
    this.lightBar.style.display = lantern === null ? 'none' : 'block';
    if (lantern !== null) {
      this.lightBar.setAttribute('aria-label', `Light ${lantern} percent`);
      this.lightBar.classList.toggle('low', lantern <= 25);
      const fill = el('div', 'fill');
      fill.style.width = `${Math.max(0, Math.min(100, lantern))}%`;
      this.lightBar.appendChild(fill);
    }
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
    if (speaker) box.appendChild(rich('div', 'speaker', speaker));
    if (d.view.kind === 'line') {
      const t = rich('div', 'text', d.view.text);
      t.setAttribute('data-testid', 'tw-dialogue-text');
      box.appendChild(t);
      box.appendChild(el('div', 'more', this.tr('E / click: continue')));
      box.onclick = () => confirmDialogue(contextOf(sim));
    } else {
      if (d.view.prompt) {
        const t = rich('div', 'text', d.view.prompt);
        t.setAttribute('data-testid', 'tw-dialogue-text');
        box.appendChild(t);
      }
      const list = el('div', 'tw-choices');
      d.view.options.forEach((o, i) => {
        const c = rich('div', `tw-choice${i === d.selected ? ' on' : ''}`, o.text);
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
      case 'title': {
        title = this.titleInfo?.text ?? '';
        hint = 'W / S to choose, E to select';
        const latest = this.slotCache.filter((s) => s.exists && !s.damaged).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
        if (latest) {
          rows.push({
            label: 'Continue',
            detail: latest.label,
            run: () =>
              void h.loadFrom(latest.slot).then((msg) => {
                this.closeMenu();
                this.toast(msg);
              }),
            testId: 'continue',
          });
        }
        rows.push({ label: 'New game', run: () => this.closeMenu(), testId: 'new-game' });
        rows.push({ label: 'Load game', run: () => this.go('load'), testId: 'load' });
        rows.push({ label: 'Settings', run: () => this.go('settings'), testId: 'settings' });
        if (h.quit) rows.push({ label: 'Quit', run: () => h.quit?.(), testId: 'quit' });
        break;
      }
      case 'main':
        rows.push({ label: 'Resume', run: () => this.closeMenu(), testId: 'resume' });
        rows.push({ label: 'Inventory', run: () => this.go('inventory'), testId: 'inventory' });
        if (sim.assets.worldMap && sim.assets.worldMap.nodes.length > 0) rows.push({ label: 'Map', run: () => this.go('map'), testId: 'map' });
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
      case 'map': {
        title = sim.assets.worldMap?.title || 'Map';
        const places = this.mapPlaces();
        if (places.length === 0) rows.push({ label: 'Nowhere to go yet.' });
        for (const p of places) {
          const here = p.state === 'here';
          rows.push({
            label: p.node.label,
            detail: here ? 'you are here' : '',
            run: here ? undefined : () => this.travelToPlace(p.node),
            testId: `place-${p.node.id}`,
          });
        }
        hint = 'Arrows or W A S D: choose a place   E or click: travel   Esc: back';
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
        const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'voice'): Row => ({
          label,
          detail: `${Math.round(set[key] * 100)}%`,
          adjust: (d) => h.changeSettings({ [key]: Math.min(1, Math.max(0, Math.round((set[key] + d * 0.1) * 10) / 10)) }),
          run: () => h.changeSettings({ [key]: set[key] > 0 ? 0 : 0.8 }),
          testId: `set-${key}`,
        });
        rows.push(slider('Master volume', 'master'), slider('Music volume', 'music'), slider('Effects volume', 'sfx'), slider('Voice volume', 'voice'));
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
        const labels = h.actionLabels?.() ?? ACTION_LABELS;
        for (const action of Object.keys(labels)) {
          rows.push({
            label: labels[action]!,
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
    if (!this.builtinOpen) {
      if (this.menuEl) this.closeMenu();
      return;
    }
    const { title, hint } = this.buildRows();
    this.focus = Math.min(this.focus, Math.max(0, this.rows.length - 1));
    const sig = JSON.stringify([this.screen, this.focus, this.rows.map((r) => [r.label, r.detail]), this.message, this.capturing, this.host.sim.assets.strings.language]);
    if (this.menuEl && this.menuEl.dataset.sig === sig) return;
    this.menuEl?.remove();
    const wrap = el('div', this.screen === 'title' ? 'tw-menu front' : 'tw-menu');
    wrap.dataset.sig = sig;
    wrap.setAttribute('data-testid', 'tw-menu');
    const panel = el('div', this.screen === 'map' ? 'tw-panel wide' : 'tw-panel');
    if (this.screen === 'title') {
      const h1 = rich('h1', 'tw-game-title', this.tr(title));
      h1.setAttribute('data-testid', 'tw-game-title');
      panel.appendChild(h1);
      if (this.titleInfo?.subtitle) panel.appendChild(rich('div', 'tw-subtitle', this.tr(this.titleInfo.subtitle)));
    } else panel.appendChild(el('h2', '', this.tr(title)));
    if (this.screen === 'map' && this.host.sim.assets.worldMap) panel.appendChild(this.mapSvg());
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
