import { CUTSCENE_STEP_LABELS, type CutsceneData, type CutsceneStep } from '@tilewright/runtime';

/** The rows of the timeline: what a step is about. */
export type Track = 'camera' | 'people' | 'story' | 'world';

export const TRACKS: { id: Track; label: string }[] = [
  { id: 'camera', label: 'Camera and screen' },
  { id: 'people', label: 'People' },
  { id: 'story', label: 'Talking' },
  { id: 'world', label: 'World and sound' },
];

type StepType = CutsceneStep['type'];

const TRACK_OF: Record<StepType, Track> = {
  cameraTo: 'camera',
  cameraReset: 'camera',
  fade: 'camera',
  shake: 'camera',
  move: 'people',
  face: 'people',
  animation: 'people',
  say: 'story',
  dialogue: 'story',
  waitInput: 'story',
  message: 'story',
  wait: 'world',
  sound: 'world',
  music: 'world',
  setVariable: 'world',
  give: 'world',
};

export const trackOf = (type: StepType): Track => TRACK_OF[type];

/** Steps whose length is a setting (so a block can be stretched). */
const TIMED = new Set<StepType>(['wait', 'cameraTo', 'cameraReset', 'fade', 'shake']);
export const hasDuration = (type: StepType): boolean => TIMED.has(type);

export interface Block {
  id: string;
  index: number;
  type: StepType;
  track: Track;
  /** Seconds from the start of the cutscene. */
  start: number;
  /** Seconds the step takes (a guess for steps that wait for the player or for a walk). */
  duration: number;
  /** The real length is not known in advance. */
  open: boolean;
  /** The step is over in an instant (a sound, a flag). */
  instant: boolean;
  /** The next step starts at once. */
  parallel: boolean;
  /** What to write on the block. */
  label: string;
  /** Row inside the track when blocks overlap. */
  lane: number;
}

const INSTANT = 0.35;

function lengthOf(s: CutsceneStep): { duration: number; open: boolean; instant: boolean } {
  switch (s.type) {
    case 'wait':
    case 'cameraTo':
    case 'cameraReset':
    case 'fade':
    case 'shake':
      return { duration: Math.max(0.1, s.seconds), open: false, instant: false };
    case 'move':
      return { duration: 2, open: true, instant: false };
    case 'say':
      return { duration: 2.5, open: true, instant: false };
    case 'dialogue':
      return { duration: 3, open: true, instant: false };
    case 'waitInput':
      return { duration: 1.5, open: true, instant: false };
    default:
      return { duration: INSTANT, open: false, instant: true };
  }
}

function labelOf(s: CutsceneStep): string {
  const name = CUTSCENE_STEP_LABELS[s.type];
  switch (s.type) {
    case 'say':
      return s.text ? `${s.speaker ? `${s.speaker}: ` : ''}${s.text}` : name;
    case 'dialogue':
      return s.dialogue ? `Dialogue: ${s.dialogue}` : name;
    case 'move':
      return `${s.who || 'Someone'} walks`;
    case 'sound':
    case 'music':
      return s.name ? `${name}: ${s.name}` : name;
    case 'message':
      return s.text ? `Message: ${s.text}` : name;
    case 'animation':
      return s.clip ? `Animation: ${s.clip}` : name;
    default:
      return name;
  }
}

/**
 * Lay the steps out in time. A step starts when the one before it has finished, unless the one before it was marked
 * "keep going", which makes the two run side by side. Blocks that overlap in one track get their own row.
 */
export function schedule(c: CutsceneData): Block[] {
  let t = 0;
  const blocks: Block[] = [];
  c.steps.forEach((s, index) => {
    const len = lengthOf(s);
    blocks.push({
      id: s.id,
      index,
      type: s.type,
      track: trackOf(s.type),
      start: t,
      duration: len.duration,
      open: len.open,
      instant: len.instant,
      parallel: s.async && s.type !== 'waitInput',
      label: labelOf(s),
      lane: 0,
    });
    if (!(s.async && s.type !== 'waitInput')) t += len.duration;
  });
  for (const track of TRACKS) {
    const rows: number[] = []; // when each row becomes free
    for (const b of blocks.filter((x) => x.track === track.id)) {
      let lane = rows.findIndex((free) => free <= b.start + 1e-9);
      if (lane < 0) lane = rows.length;
      rows[lane] = b.start + b.duration;
      b.lane = lane;
    }
  }
  return blocks;
}

/** How long the whole cutscene runs, as far as it can be known. */
export function totalTime(blocks: readonly Block[]): number {
  return blocks.reduce((m, b) => Math.max(m, b.start + b.duration), 0);
}

/** Stretch or shrink a timed step (to the nearest tenth of a second). Other steps are returned unchanged. */
export function setDuration(c: CutsceneData, id: string, seconds: number): CutsceneData {
  const s = Math.max(0, Math.round(seconds * 10) / 10);
  return { ...c, steps: c.steps.map((st) => (st.id === id && hasDuration(st.type) ? ({ ...st, seconds: st.type === 'wait' ? Math.max(0.1, s) : s } as CutsceneStep) : st)) };
}
