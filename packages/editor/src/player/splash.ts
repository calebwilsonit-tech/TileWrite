// The splash screen of an exported game: a studio's picture, a line of text and a "Made with Tilewright" card, one after another,
// while the game loads behind them. Any key, click or pad button skips the card on show. Nothing here runs in the editor.
import tilewrightMark from '../../build/icon.svg?raw';

export type SplashCard = { kind: 'image'; url: string } | { kind: 'text'; text: string } | { kind: 'made' };

/** The cards a game's splash shows, in order. */
export function splashCards(m: { splashImage?: string; splashText?: string; madeWith?: boolean }, imageUrl: string | null): SplashCard[] {
  const out: SplashCard[] = [];
  if (m.splashImage && imageUrl) out.push({ kind: 'image', url: imageUrl });
  if (m.splashText) out.push({ kind: 'text', text: m.splashText });
  if (m.madeWith) out.push({ kind: 'made' });
  return out;
}

/** How long a card stays fully on show (milliseconds), between fading in and fading out. */
export const HOLD_MS: Record<SplashCard['kind'], number> = { image: 1700, text: 1500, made: 1300 };
const FADE_IN = 450;
const FADE_OUT = 350;

export function mimeOf(file: string): string {
  return /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
}

function cardElement(card: SplashCard): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;opacity:0;max-width:90%;max-height:90%';
  if (card.kind === 'image') {
    const img = document.createElement('img');
    img.src = card.url;
    img.alt = '';
    img.style.cssText = 'max-width:min(70vw,900px);max-height:62vh;object-fit:contain';
    el.append(img);
  } else if (card.kind === 'text') {
    const t = document.createElement('div');
    t.textContent = card.text;
    t.style.cssText = 'font-size:28px;letter-spacing:0.04em';
    el.append(t);
  } else {
    el.setAttribute('data-testid', 'game-splash-made-with');
    const mark = document.createElement('div');
    mark.innerHTML = tilewrightMark;
    const svg = mark.querySelector('svg');
    if (svg) svg.setAttribute('style', 'width:min(22vh,170px);height:auto;display:block');
    const small = document.createElement('div');
    small.textContent = 'MADE WITH';
    small.style.cssText = 'font-size:15px;letter-spacing:0.35em;opacity:0.7';
    const name = document.createElement('div');
    name.textContent = 'TILEWRIGHT';
    name.style.cssText = 'font-size:40px;font-weight:700;letter-spacing:0.18em;margin-top:-10px';
    el.append(mark, small, name);
  }
  return el;
}

const wait = (ms: number, skip: { now: (() => void) | null }): Promise<void> =>
  new Promise((resolve) => {
    const t = window.setTimeout(done, ms);
    function done(): void {
      window.clearTimeout(t);
      skip.now = null;
      resolve();
    }
    skip.now = done;
  });

/**
 * Show the cards over `parent`. `done()` resolves once every card has been shown (or skipped) and then fades the splash away;
 * call it when the game has loaded, so a slow load keeps the black screen up rather than showing an empty window.
 */
export function playSplash(parent: HTMLElement, cards: SplashCard[]): { done(): Promise<void> } {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'game-splash');
  Object.assign(el.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0c10', color: '#e6e8ee', textAlign: 'center', zIndex: '99999', userSelect: 'none', cursor: 'default' });
  parent.appendChild(el);
  const skip: { now: (() => void) | null } = { now: null };
  let skipping = false;
  const press = (): void => {
    skipping = true;
    skip.now?.();
  };
  window.addEventListener('keydown', press);
  window.addEventListener('pointerdown', press);
  // a pad's buttons: looked at every frame while the splash is up
  let polling = true;
  const pads = (): void => {
    if (!polling) return;
    for (const p of navigator.getGamepads?.() ?? []) if (p?.buttons.some((b) => b.pressed)) press();
    requestAnimationFrame(pads);
  };
  requestAnimationFrame(pads);

  const shown = (async () => {
    for (const card of cards) {
      skipping = false;
      const c = cardElement(card);
      el.replaceChildren(c);
      c.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: FADE_IN, easing: 'ease-out', fill: 'forwards' });
      await wait(FADE_IN + HOLD_MS[card.kind], skip);
      c.getAnimations().forEach((a) => a.cancel());
      c.style.opacity = '1';
      await c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: skipping ? 150 : FADE_OUT, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => undefined);
    }
    el.replaceChildren();
  })();

  return {
    async done() {
      await shown;
      polling = false;
      window.removeEventListener('keydown', press);
      window.removeEventListener('pointerdown', press);
      await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => undefined);
      el.remove();
    },
  };
}
