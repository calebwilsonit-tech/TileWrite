import { useState } from 'react';
import { useApp, store } from '../app/store';
import { TEMPLATES } from '../project/templates';
import { Toasts } from '../app/Chrome';

export function ProjectScreen() {
  const recent = useApp((s) => s.recent);
  const busy = useApp((s) => s.busy);
  const [name, setName] = useState('My Game');
  const [template, setTemplate] = useState(TEMPLATES[0]!.id);
  const [showNew, setShowNew] = useState(false);

  return (
    <main className="projects" data-testid="project-screen">
      <header>
        <h1>Tilewright</h1>
        <p>Make isometric games without writing code.</p>
      </header>

      <div className="projects-grid">
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
                {TEMPLATES.map((t) => (
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
