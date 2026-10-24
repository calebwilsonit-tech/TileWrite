import { useEffect, useState } from 'react';
import { useApp, store } from '../app/store';
import { listTemplates } from '../project/templates';
import { Toasts } from '../app/Chrome';
import { tutorial } from '../tutorial/store';
import { api } from '../project/api';

export function ProjectScreen() {
  const recent = useApp((s) => s.recent);
  const busy = useApp((s) => s.busy);
  const [name, setName] = useState('My Game');
  const [template, setTemplate] = useState(listTemplates()[0]!.id);
  const [showNew, setShowNew] = useState(false);
  const [samples, setSamples] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api().samples.list().then(setSamples, () => setSamples([]));
  }, []);

  return (
    <main className="projects" data-testid="project-screen">
      <header>
        <h1>Tilewright</h1>
        <p>Make isometric games without writing code.</p>
        <button data-testid="btn-access" onClick={() => document.dispatchEvent(new CustomEvent('tw:accessibility'))} title="Accessibility: text size, colour-blind-safe colours, less motion">
          Aa Accessibility
        </button>
      </header>

      <div className="projects-grid">
        <section className="card">
          <h2>New here?</h2>
          <p className="hint">Build a small puzzle room (a crate, a plate and a gate) in about ten minutes. No code.</p>
          <button className="primary" data-testid="btn-tutorial" disabled={busy} onClick={() => void store.newProjectUnique('Tutorial Room', 'empty-iso').then((ok) => ok && tutorial.start())}>
            Take the tutorial
          </button>
          {samples.length > 0 && (
            <>
              <hr />
              <h2>See a finished game</h2>
              <p className="hint">A small complete game, made only with this editor. It is copied into a folder you choose, so you can change it freely.</p>
              {samples.map((s) => (
                <button key={s.id} data-testid={`sample-${s.id}`} disabled={busy} onClick={() => void store.openSample(s.id)}>
                  Open "{s.name}"…
                </button>
              ))}
            </>
          )}
        </section>

        <section className="card">
          <h2>New project</h2>
          {!showNew ? (
            <button className="primary" data-testid="btn-new-project" onClick={() => setShowNew(true)}>
              Start a new project…
            </button>
          ) : (
            <>
              <label className="field">
                <span>Project name</span>
                <input data-testid="project-name-input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="templates" role="radiogroup" aria-label="Template">
                {listTemplates().map((t) => (
                  <label key={t.id} className={`template${template === t.id ? ' on' : ''}`}>
                    <input type="radio" name="template" data-testid={`template-${t.id}`} checked={template === t.id} onChange={() => setTemplate(t.id)} />
                    <strong>{t.name}</strong>
                    <span>{t.description}</span>
                  </label>
                ))}
              </div>
              <div className="row">
                <button onClick={() => setShowNew(false)}>Cancel</button>
                <button className="primary" data-testid="btn-create-project" disabled={busy || !name.trim()} onClick={() => void store.newProject(name, template)}>
                  Choose a folder and create
                </button>
              </div>
            </>
          )}
          <hr />
          <button data-testid="btn-open-project" disabled={busy} onClick={() => void store.openProjectDialog()}>
            Open an existing project…
          </button>
        </section>

        <section className="card">
          <h2>Recent projects</h2>
          {recent.length === 0 ? (
            <p className="hint">Projects you open or create show up here.</p>
          ) : (
            <ul className="recent" data-testid="recent-list">
              {recent.map((r) => (
                <li key={r.dir}>
                  <button className="link" data-testid="recent-item" disabled={busy} onClick={() => void store.openRecent(r.dir)}>
                    <strong>{r.name}</strong>
                    <small>{r.dir}</small>
                  </button>
                  <button title="Remove from this list (does not delete files)" aria-label={`Forget ${r.name}`} onClick={() => void store.forgetRecent(r.dir)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2>Engine samples</h2>
          <p className="hint">Small games made while building the engine.</p>
          <ul className="plain">
            <li>
              <a href="#sample-m1" data-testid="open-sample-m1">
                M1: walking square
              </a>
            </li>
            <li>
              <a href="#sample-m2" data-testid="open-sample-m2">
                M2: multi-level room
              </a>
            </li>
          </ul>
        </section>
      </div>
      <Toasts />
    </main>
  );
}
