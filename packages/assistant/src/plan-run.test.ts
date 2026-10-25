import { describe, expect, it } from 'vitest';
import { countChange, doingStep, nextStep, requestStop, resume, rollbackNote, rolledBackTo, setCheckpoint, startPlan, stepDone, stepStart, type PlanRun } from './plan-run';

const plan = (): PlanRun => startPlan('Build the camp', ['Lay the floor', 'Put up walls', 'Add a gate']);
const ok = (r: ReturnType<typeof stepStart>): PlanRun => {
  expect(r.ok).toBe(true);
  return r.run;
};

describe('carrying out a plan', () => {
  it('ticks steps off as Claude starts and finishes them, counting the changes of each', () => {
    let run = ok(stepStart(plan(), 1));
    expect(run.steps.map((s) => s.status)).toEqual(['doing', 'pending', 'pending']);
    run = countChange(countChange(run));
    expect(run.steps[0]!.changes).toBe(2);
    const done = stepDone(run, 1);
    expect(done.message).toContain('The next is step 2');
    run = ok(stepStart(done.run, 2));
    expect(run.steps.map((s) => s.status)).toEqual(['done', 'doing', 'pending']);
    expect(nextStep(run)).toBe(2);
    // starting the next step finishes the one before even if Claude forgot to say so
    run = ok(stepStart(run, 3));
    expect(run.steps.map((s) => s.status)).toEqual(['done', 'done', 'doing']);
    const last = stepDone(run, 3);
    expect(last.message).toContain('That was the last step');
    expect(nextStep(last.run)).toBeNull();
    expect(doingStep(last.run)).toBe(-1);
  });

  it('says plainly when Claude names a step that is not there', () => {
    expect(stepStart(plan(), 4)).toMatchObject({ ok: false, message: expect.stringContaining('the plan has 3 steps') });
    expect(stepDone(plan(), 0).ok).toBe(false);
  });

  it('stops between steps when the person asks: the step in progress may finish, then nothing more', () => {
    let run = ok(stepStart(plan(), 1));
    run = requestStop(run);
    // Claude finishes step 1 and the plan is held
    const done = stepDone(run, 1);
    expect(done.ok).toBe(true);
    expect(done.run.paused).toBe(true);
    expect(done.message).toContain('The user stopped the plan between steps');
    expect(stepStart(done.run, 2)).toMatchObject({ ok: false });
    // or Claude goes straight to the next step: that finishes the first, and is refused
    const skip = stepStart(run, 2);
    expect(skip.ok).toBe(false);
    expect(skip.run.paused).toBe(true);
    expect(skip.run.steps.map((s) => s.status)).toEqual(['done', 'pending', 'pending']);
    // going on lets the next step begin
    const again = stepStart(resume(done.run), 2);
    expect(again.ok).toBe(true);
    expect(again.run.paused).toBe(false);
  });

  it('puts the steps back when the project is rolled back to the start of one, and tells Claude', () => {
    let run = ok(stepStart(plan(), 1));
    run = setCheckpoint(run, 1, 'c1');
    run = countChange(run);
    run = ok(stepStart(stepDone(run, 1).run, 2));
    run = setCheckpoint(run, 2, 'c2');
    run = ok(stepStart(stepDone(run, 2).run, 3));
    run = setCheckpoint(run, 3, 'c3');
    const back = rolledBackTo(run, 2);
    expect(back.steps.map((s) => s.status)).toEqual(['done', 'undone', 'undone']);
    expect(back.steps.map((s) => s.checkpoint)).toEqual(['c1', 'c2', null]); // the later checkpoint is no longer true
    expect(back.steps[1]!.changes).toBe(0);
    expect(back.paused).toBe(true);
    expect(rollbackNote(back, 2)).toContain('start of step 2 of your plan "Build the camp"');
    expect(rollbackNote(back, 2)).toContain('every step after it');
    expect(rollbackNote(back, 3)).toContain('step 3 is undone');
    // a plan rolled back to its first step has nothing done
    expect(rolledBackTo(run, 1).steps.every((s) => s.status === 'undone')).toBe(true);
    // a step that was never begun stays as it was
    expect(rolledBackTo(plan(), 2).steps.map((s) => s.status)).toEqual(['pending', 'pending', 'pending']);
  });
});
