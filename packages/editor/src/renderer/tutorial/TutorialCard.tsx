import { useEffect } from 'react';
import { TUTORIAL_STEPS } from './steps';
import { tutorial, useTutorial } from './store';

/** The tutorial's card: where you are, what to do, and a gentle pulse around the things to use. */
export function TutorialCard() {
  const active = useTutorial((s) => s.active);
  const index = useTutorial((s) => s.index);
  const finishedAt = useTutorial((s) => s.finishedAt);
  const startedAt = useTutorial((s) => s.startedAt);
  const step = TUTORIAL_STEPS[index];
  const manual = step !== undefined && step.done === undefined;

  useEffect(() => {
    if (!active || !step?.highlight) return;
    const els = step.highlight.flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]);
    for (const el of els) el.classList.add('tw-tutorial-pulse');
    return () => {
      for (const el of els) el.classList.remove('tw-tutorial-pulse');
    };
  }, [active, index, step]);

  if (!active || !step) return null;
  const last = index === TUTORIAL_STEPS.length - 1;
  const minutes = finishedAt ? Math.max(1, Math.round((finishedAt - startedAt) / 60_000)) : null;
  return (
    <aside className="tutorial-card" role="complementary" aria-label="Tutorial" data-testid="tutorial" data-step={step.id}>
      <p className="tutorial-progress" data-testid="tutorial-progress">
        Step {index + 1} of {TUTORIAL_STEPS.length}
        <span className="bar" aria-hidden="true">
          <span style={{ width: `${((index + 1) / TUTORIAL_STEPS.length) * 100}%` }} />
        </span>
      </p>
      <h3 data-testid="tutorial-title">{step.title}</h3>
      <p data-testid="tutorial-text">{step.text}</p>
      {last && minutes !== null && <p className="hint ok">You got here in about {minutes} minute{minutes === 1 ? '' : 's'}.</p>}
      <div className="row">
        {index > 0 && !last && (
          <button data-testid="tutorial-back" onClick={() => tutorial.back()}>
            Back
          </button>
        )}
        {!manual && !last && (
          <button data-testid="tutorial-skip" onClick={() => tutorial.next()} title="Move on without doing this step">
            Skip this step
          </button>
        )}
        {(manual || last) && (
          <button className="primary" data-testid="tutorial-next" onClick={() => tutorial.next()}>
            {last ? 'Finish' : index === 0 ? 'Start' : 'Next'}
          </button>
        )}
        <button data-testid="tutorial-close" onClick={() => tutorial.close()} title="Close the tutorial (you can start it again from Commands)">
          Close
        </button>
      </div>
    </aside>
  );
}
