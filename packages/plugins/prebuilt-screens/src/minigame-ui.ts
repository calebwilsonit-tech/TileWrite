import { confirmMinigame } from '@tilewright/plugin-story';
import { clickMinigame, defaultInstructions, minigamesOf, openMinigame, pairColumns, symbolDirs, type MinigameData, type MinigameState } from '@tilewright/plugin-story/minigames';
import {
  contextOf,
  type Simulation,
} from '@tilewright/plugin-sdk';


/** Strings the minigame screens show (so a translator sees them). */
export const MINIGAME_STRINGS: readonly string[] = [
  'E / click: start',
  'E / click: continue',
  'Esc or P: give up',
  'You won!',
  'You lost.',
  'Score {n}',
  'Watch the pattern...',
  'Your turn: {n} of {total}',
  'Press E when the marker is inside the bright zone.',
  'Watch the arrows, then press them in the same order.',
  'Move with the arrows and press E to flip a card. Find every matching pair.',
  'Round {n} of {total}',
  'Misses: {n}',
  'Pairs found: {n} of {total}',
];

export const MINIGAME_CSS = `
.tw-minigame { position: absolute; inset: 0; background: #05060ce6; display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.tw-minigame .mg-panel { width: min(88%, 560px); background: #14161b; border: 2px solid #d9c6a0; border-radius: 12px; padding: 18px 22px; text-align: center; }
.tw-minigame h2 { margin: 0 0 6px; font-size: 22px; font-weight: normal; color: #ffd98a; }
.tw-minigame .mg-text { font-size: 16px; line-height: 1.4; margin: 6px 0 12px; }
.tw-minigame .mg-status { font-size: 13px; opacity: .8; margin: 8px 0; min-height: 1.3em; }
.tw-minigame .mg-hint { margin-top: 12px; font-size: 12px; opacity: .7; }
.tw-minigame .mg-result { font-size: 26px; color: #ffd98a; margin: 10px 0 2px; }
.tw-minigame .mg-bar { position: relative; height: 34px; background: #1b1d24; border: 2px solid #000; border-radius: 8px; margin: 18px 0 10px; overflow: hidden; }
.tw-minigame .mg-zone { position: absolute; top: 0; bottom: 0; background: #5fd38a; opacity: .85; }
.tw-minigame .mg-bar.hit { border-color: #5fd38a; } .tw-minigame .mg-bar.miss { border-color: #e0566b; }
.tw-minigame .mg-marker { position: absolute; top: 0; bottom: 0; width: 6px; margin-left: -3px; background: #fff; box-shadow: 0 0 8px #fff; }
.tw-minigame .mg-arrows { display: flex; gap: 10px; justify-content: center; margin: 14px 0; }
.tw-minigame .mg-arrow { width: 64px; height: 64px; border-radius: 10px; border: 2px solid #ffffff55; background: #1b1d24; font-size: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.tw-minigame .mg-arrow.lit { background: #ffd98a; color: #14161b; border-color: #fff; }
.tw-minigame .mg-cards { display: grid; gap: 8px; justify-content: center; margin: 14px 0; }
.tw-minigame .mg-card { width: 64px; height: 76px; border-radius: 8px; border: 2px solid #ffffff55; background: #2b3350; display: flex; align-items: center; justify-content: center; font-size: 30px; cursor: pointer; }
.tw-minigame .mg-card.on { border-color: #6aa8ff; box-shadow: 0 0 8px #6aa8ff; }
.tw-minigame .mg-card.up { background: #f4efe6; }
.tw-minigame .mg-card.done { background: #3a7d55; opacity: .85; }
`;

const ARROW: Record<string, string> = { up: '▲', right: '▶', down: '▼', left: '◀' };
const FACES = ['★', '♥', '♦', '♣', '♠', '☾', '☀', '✿', '♪', '⚑'];
const FACE_COLORS = ['#c58a00', '#c8364b', '#2a6fd0', '#2f8f4e', '#33333f', '#6a4bb5', '#d06a1a', '#b03a8f', '#1d8f8f', '#6b5a2a'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * The minigame screen: the same plain-DOM approach as the rest of the game's interface. It is rebuilt when the game
 * state changes in a way a player can see, and only the sliding marker moves on every frame, so clicks are never lost
 * to a rebuild between pressing and releasing the mouse.
 */
export class MinigameView {
  private box: HTMLElement | null = null;
  private sig = '';
  private marker: HTMLElement | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly sim: Simulation,
  ) {}

  private tr(s: string): string {
    return this.sim.assets.strings.t(s);
  }

  private fmt(s: string, v: Record<string, string | number>): string {
    return this.sim.assets.strings.fmt(s, v);
  }

  update(): void {
    const st = openMinigame(this.sim.runtime);
    const m = st ? minigamesOf(this.sim.assets).get(st.name) : undefined;
    if (!st || !m) {
      this.box?.remove();
      this.box = null;
      this.marker = null;
      this.sig = '';
      return;
    }
    const sig = JSON.stringify({ ...st, t: 0, pos: 0, dir: 1, flashT: 0, lock: st.lock > 0 ? 1 : 0 });
    if (!this.box || sig !== this.sig) {
      this.box?.remove();
      this.sig = sig;
      this.box = this.build(m, st);
      this.parent.appendChild(this.box);
    }
    if (this.marker) this.marker.style.left = `${st.pos * 100}%`;
  }

  private build(m: MinigameData, st: MinigameState): HTMLElement {
    const root = el('div', 'tw-minigame');
    root.setAttribute('data-testid', 'tw-minigame');
    root.dataset.phase = st.phase;
    const panel = el('div', 'mg-panel');
    panel.appendChild(el('h2', '', this.tr(m.title || m.name)));
    this.marker = null;
    const act = (target: { symbol?: number; card?: number }): void => clickMinigame(m, st, target);

    if (st.phase === 'intro') {
      panel.appendChild(el('div', 'mg-text', this.tr(m.instructions || defaultInstructions(m.kind))));
      panel.appendChild(el('div', 'mg-hint', this.tr('E / click: start')));
      root.onclick = () => confirmMinigame(contextOf(this.sim));
    } else if (st.phase === 'won' || st.phase === 'lost') {
      const r = el('div', 'mg-result', this.tr(st.phase === 'won' ? 'You won!' : 'You lost.'));
      r.setAttribute('data-testid', 'tw-minigame-result');
      panel.appendChild(r);
      panel.appendChild(el('div', 'mg-text', this.fmt('Score {n}', { n: st.score })));
      panel.appendChild(el('div', 'mg-hint', this.tr('E / click: continue')));
      root.onclick = () => confirmMinigame(contextOf(this.sim));
    } else {
      this.buildPlay(panel, m, st, act);
      if (m.canQuit) panel.appendChild(el('div', 'mg-hint', this.tr('Esc or P: give up')));
    }
    root.appendChild(panel);
    return root;
  }

  private buildPlay(panel: HTMLElement, m: MinigameData, st: MinigameState, act: (t: { symbol?: number; card?: number }) => void): void {
    if (m.kind === 'timing') {
      const bar = el('div', `mg-bar ${st.flash}`);
      bar.setAttribute('data-testid', 'tw-minigame-bar');
      const zone = el('div', 'mg-zone');
      zone.style.left = `${st.zoneAt * 100}%`;
      zone.style.width = `${st.zoneSize * 100}%`;
      const marker = el('div', 'mg-marker');
      marker.style.left = `${st.pos * 100}%`;
      bar.append(zone, marker);
      this.marker = marker;
      panel.appendChild(bar);
      panel.appendChild(el('div', 'mg-status', this.fmt('Round {n} of {total}', { n: Math.min(m.rounds, st.round + 1), total: m.rounds })));
      panel.appendChild(el('div', 'mg-status', this.fmt('Misses: {n}', { n: st.misses })));
    } else if (m.kind === 'sequence') {
      const row = el('div', 'mg-arrows');
      symbolDirs(m.buttons).forEach((d, i) => {
        const a = el('div', `mg-arrow${st.lit === i ? ' lit' : ''}`, ARROW[d]);
        a.setAttribute('data-testid', `tw-minigame-arrow-${i}`);
        a.onclick = () => act({ symbol: i });
        row.appendChild(a);
      });
      panel.appendChild(row);
      panel.appendChild(el('div', 'mg-status', st.phase === 'show' ? this.tr('Watch the pattern...') : this.fmt('Your turn: {n} of {total}', { n: Math.min(st.seq.length, st.entered + 1), total: st.seq.length })));
    } else {
      const grid = el('div', 'mg-cards');
      grid.style.gridTemplateColumns = `repeat(${pairColumns(st.cards.length)}, 64px)`;
      st.cards.forEach((c, i) => {
        const face = st.faces[i]!;
        const card = el('div', `mg-card ${face}${st.cursor === i ? ' on' : ''}`, face === 'down' ? '?' : FACES[c % FACES.length]!);
        if (face !== 'down') card.style.color = FACE_COLORS[c % FACE_COLORS.length]!;
        card.setAttribute('data-testid', `tw-minigame-card-${i}`);
        card.onclick = () => act({ card: i });
        grid.appendChild(card);
      });
      panel.appendChild(grid);
      panel.appendChild(el('div', 'mg-status', this.fmt('Pairs found: {n} of {total}', { n: st.faces.filter((f) => f === 'done').length / 2, total: m.pairs })));
    }
  }

  destroy(): void {
    this.box?.remove();
    this.box = null;
  }
}
