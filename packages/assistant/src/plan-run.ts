/**
 * A plan being carried out: its steps, which are done, which is being worked on, whether the person asked to stop between steps,
 * and where the project can be put back to (a checkpoint taken before each step). Pure state and rules (no editor, no files), so
 * the rules are tested on their own; the editor keeps one of these and shows it.
 */

export type StepStatus = 'pending' | 'doing' | 'done' | 'undone';

export interface PlanStep {
  text: string;
  status: StepStatus;
  /** Changes made while this step was being worked on. */
  changes: number;
  /** The checkpoint taken before the step began (null: none could be taken, or it has not begun). */
  checkpoint: string | null;
}

export interface PlanRun {
  title: string;
  steps: PlanStep[];
  /** The person asked to stop when the step being worked on is done. */
  stopAfter: boolean;
  /** The plan is held between steps: nothing is changed until the person says to go on. */
  paused: boolean;
}

export function startPlan(title: string, steps: readonly string[]): PlanRun {
  return { title, steps: steps.map((text) => ({ text, status: 'pending', changes: 0, checkpoint: null })), stopAfter: false, paused: false };
}

export type StepResult = { ok: true; run: PlanRun; /** What to tell Claude. */ message: string } | { ok: false; run: PlanRun; message: string };

const replace = (run: PlanRun, i: number, patch: Partial<PlanStep>): PlanRun => ({ ...run, steps: run.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

export const doingStep = (run: PlanRun): number => run.steps.findIndex((s) => s.status === 'doing');

/** The number (1-based) of the first step not done yet, or null when all are. */
export function nextStep(run: PlanRun): number | null {
  const i = run.steps.findIndex((s) => s.status === 'pending' || s.status === 'undone' || s.status === 'doing');
  return i < 0 ? null : i + 1;
}

const STOPPED = 'The user stopped the plan between steps. Do not start another step or change anything. Say what is finished and what is left, and wait: they can tell you to go on, or roll the project back to the start of a step.';

/** Claude says a step begins. Refused when the plan is held, or when the person asked to stop and the step before is finished. */
export function stepStart(run: PlanRun, n: number): StepResult {
  if (n < 1 || n > run.steps.length) return { ok: false, run, message: `There is no step ${n}: the plan has ${run.steps.length} step${run.steps.length === 1 ? '' : 's'} (1 to ${run.steps.length}).` };
  if (run.paused) return { ok: false, run, message: STOPPED };
  let next = run;
  // starting a step finishes the one that was being worked on
  const open = doingStep(next);
  if (open >= 0 && open !== n - 1) next = replace(next, open, { status: 'done' });
  // the person asked to stop: a step that begins now is one too many
  if (next.stopAfter && open !== n - 1) return { ok: false, run: { ...next, paused: true, stopAfter: false }, message: STOPPED };
  next = replace(next, n - 1, { status: 'doing' });
  return { ok: true, run: next, message: `Step ${n} begun: ${next.steps[n - 1]!.text}` };
}

/** Claude says a step is finished. */
export function stepDone(run: PlanRun, n: number): StepResult {
  if (n < 1 || n > run.steps.length) return { ok: false, run, message: `There is no step ${n}: the plan has ${run.steps.length} step${run.steps.length === 1 ? '' : 's'} (1 to ${run.steps.length}).` };
  let next = replace(run, n - 1, { status: 'done' });
  const left = nextStep(next);
  if (run.stopAfter) {
    next = { ...next, paused: true, stopAfter: false };
    return { ok: true, run: next, message: `Step ${n} done. ${STOPPED}` };
  }
  return { ok: true, run: next, message: left === null ? `Step ${n} done. That was the last step: say what was done and check the result.` : `Step ${n} done. The next is step ${left}.` };
}

/** A change was made: it counts for the step being worked on. */
export function countChange(run: PlanRun): PlanRun {
  const i = doingStep(run);
  return i < 0 ? run : replace(run, i, { changes: run.steps[i]!.changes + 1 });
}

export function setCheckpoint(run: PlanRun, n: number, id: string): PlanRun {
  return replace(run, n - 1, { checkpoint: id });
}

/** The person asks to stop when the current step is done. */
export function requestStop(run: PlanRun): PlanRun {
  return { ...run, stopAfter: true };
}

/** The person says to go on (or changes their mind about stopping). */
export function resume(run: PlanRun): PlanRun {
  return { ...run, stopAfter: false, paused: false };
}

/** The project was put back to before step n: that step and every later one is to be done again, and the plan is held. */
export function rolledBackTo(run: PlanRun, n: number): PlanRun {
  const undone = (s: PlanStep, i: number): PlanStep => ({ ...s, status: s.status === 'pending' ? 'pending' : 'undone', changes: 0, checkpoint: i === n - 1 ? s.checkpoint : null });
  return { ...run, paused: true, stopAfter: false, steps: run.steps.map((s, i) => (i >= n - 1 ? undone(s, i) : s)) };
}

/** What Claude is told at the person's next message after a roll back to a step. */
export const rollbackNote = (run: PlanRun, n: number): string => `(The user rolled the project back to the start of step ${n} of your plan "${run.title}": step ${n}${n < run.steps.length ? ' and every step after it are' : ' is'} undone and not done any more. Nothing from them is in the project. Do them again only if the user says so.)`;
