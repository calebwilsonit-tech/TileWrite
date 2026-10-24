import { MINIGAME_CSS, MINIGAME_STRINGS, MinigameView } from './minigame-ui';
import { screenWords } from './screens';
import { WORLD_MAP_CSS } from './world-map';
import {
  activeActionLabels,
  availableSkins,
  completeLayout,
  defaultUiLayout,
  themeVars,
  widgetCss,
  type UiLayout,
  type UiWidget,
  bindingLabel,
  languageChoices,
  parseRichText,
  type GameSettings,
  compositeFrame,
  openStartScreens,
  openRole,
  roleOpen,
  closeScreen,
  screenForRole,
  sync,
  withPluginScreens,
  type SlotInfo,
  contextOf,
  routeInput,
  SCREENS_CSS,
  UiScreens,
  setUiBridge,
  type GameUiHost,
  type GameUiLike,
  type TitleInfo,
} from '@tilewright/plugin-sdk';
import { confirmDialogue, selectChoice } from '@tilewright/plugin-story';

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
export const uiStrings = (): string[] => [...new Set([...UI_STRINGS, ...screenWords(), ...Object.values(activeActionLabels())])];

const CSS = `
.tw-ui { position: absolute; inset: 0; pointer-events: none; font-family: var(--tw-font, Georgia, 'Times New Roman', serif); color: var(--tw-text, #f4efe6); user-select: none; }
.tw-ui * { box-sizing: border-box; }
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
.tw-hidden { display: none !important; }
.tw-tint { position: absolute; inset: 0; pointer-events: none; display: none; mix-blend-mode: multiply; }
.tw-selectbox { position: absolute; border: 1px solid #7dffb2; background: #7dffb222; display: none; pointer-events: none; }
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
export class GameUi implements GameUiLike {
  private readonly root = el('div', 'tw-ui');
  private readonly toasts = el('div', 'tw-toasts');
  private readonly fade = el('div', 'tw-fade');
  private readonly skip = el('div', 'tw-skip');
  /** The rectangle being dragged to select units. */
  private readonly selectBox = el('div', 'tw-selectbox');
  /** Night and dusk: a colour over the picture. */
  private readonly tint = el('div', 'tw-tint');
  private dialogueEl: HTMLElement | null = null;
  private layout: UiLayout = defaultUiLayout();
  /** Inline styles put on a piece by the layout, so the next layout can take them off again. */
  private readonly applied = new Map<HTMLElement, string[]>();
  private readonly minigame: MinigameView;
  /** The screens made in the UI designer (assets/screens.json). */
  readonly screens: UiScreens;
  private readonly style = el('style');
  /** Set while the title screen is the game's front door: the pause keys cannot close it. */
  private titleInfo: TitleInfo | null = null;
  private lastTick = -1;
  private lastStack = '';
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
    this.style.textContent = CSS + MINIGAME_CSS + SCREENS_CSS + WORLD_MAP_CSS;
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
      saves: () => this.slotCache,
      refreshSaves: () => void this.refreshSlots(),
      title: () => (this.titleInfo ? { text: this.tr(this.titleInfo.text), subtitle: this.tr(this.titleInfo.subtitle) } : null),
      controls: () => Object.entries(host.actionLabels?.() ?? activeActionLabels()).map(([action, label]) => ({ action, label })),
      can: (what) => (what === 'quit' ? host.quit !== undefined : what === 'fullscreen' ? host.fullscreen !== undefined : false),
      choices: (what) => this.choicesFor(what),
    });
    this.root.setAttribute('data-testid', 'tw-ui');
    this.selectBox.setAttribute('data-testid', 'tw-selectbox');
    this.root.prepend(this.tint);
    this.root.append(this.style, this.toasts, this.fade, this.skip, this.selectBox);
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

  toast(text: string): void {
    if (!text) return;
    this.toastList.push({ text, until: performance.now() + 3500 });
    if (this.toastList.length > 5) this.toastList.shift();
  }

  /** Use this theme and arrangement of the heads-up display: the theme is the page's look, the arrangement becomes the HUD screen. */
  setLayout(layout: UiLayout): void {
    this.layout = completeLayout(layout);
    for (const [k, v] of Object.entries(themeVars(this.layout.theme))) this.root.style.setProperty(k, v);
    const sim = this.host.sim;
    sim.assets.ui = withPluginScreens(sim.assets.ui, { layout: this.layout });
    // the messages are drawn by the game itself; the layout says where
    const toasts = this.layout.widgets.find((w) => w.kind === 'toasts');
    if (toasts) this.place(this.toasts, toasts);
    if (this.toasts.parentElement !== this.root) this.root.appendChild(this.toasts);
  }

  private place(target: HTMLElement, w: UiWidget): void {
    for (const k of this.applied.get(target) ?? []) target.style.removeProperty(k);
    const css = widgetCss(w, this.layout.theme.scale);
    for (const [k, v] of Object.entries(css)) target.style.setProperty(k, v);
    this.applied.set(target, Object.keys(css));
    target.classList.toggle('tw-hidden', !w.visible);
  }

  /** A screen that freezes the game is open (a menu, the title). */
  get menuOpen(): boolean {
    return this.host.sim.runtime.ui.modal;
  }

  /** Open the screen that plays the Pause part (the project's own, or the one the plugin ships). */
  openMenu(): void {
    const r = this.host.sim.runtime;
    if (r.dialogue || r.cutscene || r.minigame) return;
    openRole(this.host.sim, 'pause');
  }

  /** Show the title screen (New game, Continue, Load game, Settings, Quit); the world waits behind it. */
  openTitle(info: TitleInfo): void {
    this.titleInfo = info;
    openRole(this.host.sim, 'title');
  }

  get titleOpen(): boolean {
    return this.titleInfo !== null;
  }

  /** Open the screens that open when the game starts (a heads-up display). */
  openStart(): void {
    openStartScreens(this.host.sim);
  }

  closeMenu(): void {
    this.titleInfo = null;
    closeScreen(this.host.sim, 'role:pause');
    closeScreen(this.host.sim, 'role:title');
  }

  refreshSaves(): void {
    void this.refreshSlots();
  }

  /** The options a settings choice offers: appearances (skins) and languages, each shown by its own name. */
  private choicesFor(what: string): { value: string; label: string }[] {
    const sim = this.host.sim;
    if (what === 'skin') return [{ value: '', label: 'Original' }, ...availableSkins(sim.assets.skins, sim.runtime.vars).map((s) => ({ value: s.id, label: s.name }))];
    if (what === 'language') return languageChoices(sim.assets.strings).map((l) => ({ value: l.code, label: l.name }));
    return [];
  }

  private async refreshSlots(): Promise<void> {
    this.slotCache = await this.host.slots();
  }

  /** Call after every simulation step: buttons and menus react to each step, not only to the last one of a frame. */
  tick(): void {
    const sim = this.host.sim;
    if (sim.tick !== this.lastTick) {
      this.lastTick = sim.tick;
      this.handleInput();
    }
    this.screens.tick();
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
    // a screen opened: its list of saves is read again
    const stack = r.ui.stack.join('|');
    if (stack !== this.lastStack) {
      this.lastStack = stack;
      void this.refreshSlots();
    }
    this.screens.update();
    if (this.titleInfo && !roleOpen(sim, 'title')) this.titleInfo = null;
    this.ensureHud();
    this.drawDialogue();
    this.minigame.update();
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
    const sig = this.toastList.map((x) => x.text).join('|');
    if (this.toasts.dataset.sig !== sig) {
      this.toasts.dataset.sig = sig;
      this.toasts.replaceChildren(...this.toastList.map((x) => rich('div', 'tw-toast', x.text)));
    }
  }

  /** Back, and the keys that open Pause, the inventory and the map, are decided in one place (see router.ts). */
  private handleInput(): void {
    routeInput({ sim: this.host.sim, pauseKeyOpensPause: this.host.pauseKeyOpensPause?.() ?? true });
  }

  /** The heads-up display is always there: its screen goes at the bottom of the stack whenever something has emptied the stack. */
  private ensureHud(): void {
    const sim = this.host.sim;
    const hud = screenForRole(sim.assets, 'hud');
    if (!hud) return;
    const stack = sim.runtime.ui.stack;
    if (stack.includes(hud.name)) return;
    stack.unshift(hud.name);
    sync(sim);
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

  dispose(): void {
    for (const off of this.offs) off();
    this.root.remove();
    this.host.sim.runtime.menuOpen = false;
    void this.pending;
  }
}
