import { useEffect, useRef, useState } from 'react';
import { EFFORTS, EFFORT_LABELS, MAX_ATTACHMENTS, MODELS, MODE_LABELS, PERMISSIONS, PERMISSION_LABELS, compactDiff, diffStats, formatCost, type Effort, type Mode, type Permission } from '@tilewright/assistant';
import { host } from '@tilewright/behaviors';
import { store } from '../app/store';
import { api, joinPath } from '../project/api';
import { NOTES_FILE } from './editor-tools';
import { TOOL_LABELS, assistant, useAssistant, type ChatItem } from './store';

const MODES: Mode[] = ['chat', 'explain', 'fix', 'build', 'review'];

const MODE_HINTS: Record<Mode, string> = {
  chat: 'Ask anything about your project.',
  explain: 'Claude explains what you paste or describe, without changing anything.',
  fix: 'Describe an error; Claude finds the cause and proposes a fix.',
  build: 'Describe what you want, for example "a room where two helpers must hold two plates at once".',
  review: 'Claude reviews the open scene and runs the checks.',
};

function DiffView({ diff }: { diff: NonNullable<Extract<ChatItem, { kind: 'proposal' }>['diff']> }) {
  const stats = diffStats(diff.lines);
  const rows = compactDiff(diff.lines, 2);
  return (
    <details className="diff" open={stats.added + stats.removed <= 24} data-testid="proposal-diff">
      <summary>
        {diff.name}: <span className="add">+{stats.added}</span> <span className="del">-{stats.removed}</span>
      </summary>
      <pre>
        {rows.map((r, i) =>
          r.kind === 'gap' ? (
            <span key={i} className="gap">
              {`... ${r.hidden} unchanged line${r.hidden === 1 ? '' : 's'}\n`}
            </span>
          ) : (
            <span key={i} className={r.kind}>
              {`${r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}${r.text}\n`}
            </span>
          ),
        )}
      </pre>
    </details>
  );
}

function ProposalCard({ item }: { item: Extract<ChatItem, { kind: 'proposal' }> }) {
  useAssistant((s) => s.tick);
  const mine = assistant.canDecide(item.id);
  return (
    <section className={`proposal ${item.status}`} data-testid="proposal" data-status={item.status}>
      <h4>{item.title}</h4>
      {item.auto && <p className="hint" data-testid="proposal-auto">Made without asking, as you allowed.</p>}
      {item.images && item.images.length > 0 && (
        <div className="proposal-images" data-testid="proposal-images">
          {item.images.map((i, n) => (
            <img key={n} src={i.url} alt={i.name} title={i.name} style={{ imageRendering: 'pixelated', maxWidth: 192, maxHeight: 192, background: 'repeating-conic-gradient(#3a3d46 0% 25%, #2b2e36 0% 50%) 50% / 12px 12px' }} />
          ))}
        </div>
      )}
      {item.plan && item.plan.risks.length > 0 && (
        <ul className="plain warn" data-testid="plan-risks">
          {item.plan.risks.map((r, i) => (
            <li key={i}>Careful: {r}</li>
          ))}
        </ul>
      )}
      <ul className="plain">
        {item.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {item.diff && <DiffView diff={item.diff} />}
      {item.status === 'pending' && (
        <div className="row">
          <button className="primary" data-testid="proposal-apply" disabled={!mine} onClick={() => assistant.decide(item.id, true)} title={mine ? (item.plan ? 'Approve the plan: Claude carries on' : 'Make this change (one undo step)') : 'Decide the change above first'}>
            {item.plan ? 'Approve the plan' : 'Apply'}
          </button>
          <button data-testid="proposal-reject" disabled={!mine} onClick={() => assistant.decide(item.id, false)}>
            Reject
          </button>
        </div>
      )}
      {item.status === 'applied' && (
        <div className="row">
          <span className="state ok" data-testid="proposal-state">
            {item.plan ? 'Plan approved' : 'Applied'}
          </span>
          {item.undoable && (
            <button data-testid="proposal-undo" onClick={() => void assistant.undo(item.id)}>
              Undo this
            </button>
          )}
        </div>
      )}
      {item.status === 'rejected' && (
        <span className="state" data-testid="proposal-state">
          Rejected
        </span>
      )}
      {item.status === 'undone' && (
        <span className="state" data-testid="proposal-state">
          Undone
        </span>
      )}
      {item.status === 'failed' && (
        <span className="state bad" data-testid="proposal-state">
          Could not apply: {item.message}
        </span>
      )}
    </section>
  );
}

function RunCard({ item }: { item: Extract<ChatItem, { kind: 'run' }> }) {
  const busy = useAssistant((s) => s.busy);
  const available = useAssistant((s) => s.rollbackAvailable);
  return (
    <section className="proposal" data-testid="run-card">
      <h4>
        {item.changes} change{item.changes === 1 ? '' : 's'} made without asking
      </h4>
      {item.rolledBack ? (
        <p className="state" data-testid="run-state">
          {item.message}
        </p>
      ) : (
        <>
          <p className="hint">Everything this question changed can be taken back in one step: the project goes back to how it was before Claude started.</p>
          <button data-testid="run-rollback" disabled={busy || !available} onClick={() => void assistant.rollBackRun(item.id)}>
            Roll back this whole run
          </button>
          {item.message && <p className="state bad">{item.message}</p>}
        </>
      )}
    </section>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user" data-testid="chat-user">
          {item.images && (
            <div className="proposal-images" data-testid="chat-user-images">
              {item.images.map((i, n) => (
                <img key={n} src={i.url} alt={i.name} title={i.name} style={{ maxWidth: 96, maxHeight: 96 }} />
              ))}
            </div>
          )}
          {item.mode !== 'chat' && <em className="mode">{MODE_LABELS[item.mode]}: </em>}
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="msg assistant" data-testid="chat-assistant">
          {item.thinking && (
            <details className="thinking">
              <summary>How Claude thought about it</summary>
              <p>{item.thinking}</p>
            </details>
          )}
          {item.text}
        </div>
      );
    case 'tool':
      return (
        <div className={`tool ${item.status}`} data-testid="chat-tool">
          {item.status === 'running' ? '… ' : item.status === 'error' ? '! ' : '✓ '}
          {TOOL_LABELS[item.name] ?? `Asked for ${item.name}`}
          {item.status === 'error' && item.detail ? `: ${item.detail}` : ''}
        </div>
      );
    case 'proposal':
      return <ProposalCard item={item} />;
    case 'notice':
      return <div className={`notice ${item.level}`}>{item.text}</div>;
    case 'run':
      return <RunCard item={item} />;
  }
}

function KeyBox() {
  const status = useAssistant((s) => s.status);
  const [key, setKey] = useState('');
  if (!status) return null;
  if (status.hasKey) {
    return (
      <div className="row key-row" data-testid="key-saved">
        <span>Your API key is saved on this computer (in the system keychain){status.customEndpoint ? ', and requests go to a custom address (test or proxy setup)' : ''}.</span>
        <button data-testid="key-remove" onClick={() => void assistant.clearKey()}>
          Remove key
        </button>
      </div>
    );
  }
  return (
    <div className="key-box" data-testid="key-box">
      <p>
        Claude needs your own Anthropic API key (make one in the Anthropic console, under API keys). It is kept only on this computer, in the system keychain, and is sent only to Anthropic. The rest of Tilewright works without it.
      </p>
      <div className="row">
        <input data-testid="key-input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" />
        <button
          data-testid="key-save"
          className="primary"
          disabled={!key.trim() || !status.canStoreKey}
          onClick={() =>
            void assistant.setKey(key).then((ok) => {
              if (ok) setKey('');
            })
          }
        >
          Save key
        </button>
      </div>
      {!status.canStoreKey && <p className="state bad">This computer has no system keychain Tilewright can use, so the key cannot be stored safely and is not accepted.</p>}
    </div>
  );
}

/** The keys of the picture services plugins use. Each is kept by the system keychain, like the assistant's own. */
function ProviderKeys() {
  const [, bump] = useState(0);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const providers = [...host.ext.imageProviders.values()].filter((p) => p.needsKey);
  useEffect(() => {
    void Promise.all(providers.map(async (p) => [p.id, await api().assistant.providerKey.has(p.id)] as const)).then((pairs) => setSaved(Object.fromEntries(pairs)));
  }, [providers.length]);
  if (providers.length === 0) return null;
  return (
    <div data-testid="provider-keys">
      <h4>Picture providers</h4>
      {providers.map((p) => (
        <div className="row" key={p.id}>
          <span>{p.label}</span>
          {saved[p.id] ? (
            <>
              <span className="state ok">key saved</span>
              <button
                onClick={() =>
                  void api()
                    .assistant.providerKey.clear(p.id)
                    .then(() => {
                      setSaved({ ...saved, [p.id]: false });
                      bump((n) => n + 1);
                    })
                }
              >
                Remove key
              </button>
            </>
          ) : (
            <>
              <input data-testid={`provider-key-${p.id}`} type="password" autoComplete="off" placeholder="key" aria-label={`Key for ${p.label}`} value={draft[p.id] ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} />
              <button
                data-testid={`provider-key-save-${p.id}`}
                disabled={!(draft[p.id] ?? '').trim()}
                onClick={() =>
                  void api()
                    .assistant.providerKey.set(p.id, draft[p.id] ?? '')
                    .then(() => {
                      setSaved({ ...saved, [p.id]: true });
                      setDraft({ ...draft, [p.id]: '' });
                    })
                    .catch((e: unknown) => store.notify('warn', e instanceof Error ? e.message : 'The key could not be saved.'))
                }
              >
                Save key
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function NotesBox() {
  const notes = useAssistant((s) => s.notes);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? notes;
  return (
    <details className="notes" data-testid="notes-box">
      <summary>Project notes</summary>
      <p className="hint">Design notes and rules for this game (for example &ldquo;No puzzle may be bypassable&rdquo;). Claude reads this at the start of every conversation. Saved as {NOTES_FILE} in your project.</p>
      <textarea data-testid="notes-text" rows={5} value={shown} onChange={(e) => setDraft(e.target.value)} aria-label="Project notes" />
      <button
        data-testid="notes-save"
        disabled={draft === null || draft === notes}
        onClick={() => {
          const p = store.state.project;
          if (!p || draft === null) return;
          void api()
            .fs.write(joinPath(p.dir, NOTES_FILE), draft)
            .then(() => assistant.refreshNotes())
            .then(() => {
              setDraft(null);
              store.notify('info', 'Saved the project notes.');
            });
        }}
      >
        Save notes
      </button>
    </details>
  );
}

export function AssistantPanel() {
  const items = useAssistant((s) => s.items);
  const busy = useAssistant((s) => s.busy);
  const error = useAssistant((s) => s.error);
  const settings = useAssistant((s) => s.settings);
  const usage = useAssistant((s) => s.usage);
  const cost = useAssistant((s) => s.cost);
  const draft = useAssistant((s) => s.draft);
  const mode = useAssistant((s) => s.mode);
  const tick = useAssistant((s) => s.tick);
  const attachments = useAssistant((s) => s.attachments);
  const run = useAssistant((s) => s.run);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [items.length, tick, busy]);

  const submit = (): void => void assistant.send(draft);

  return (
    <div className="panel assistant" data-testid="assistant-panel">
      <div className="row wrap head">
        <select data-testid="assistant-model" aria-label="Model" value={settings.model} onChange={(e) => assistant.setSettings({ model: e.target.value })} title={MODELS.find((m) => m.id === settings.model)?.note}>
          {MODELS.some((m) => m.id === settings.model) ? null : <option value={settings.model}>{settings.model}</option>}
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select data-testid="assistant-effort" aria-label="How hard Claude thinks" value={settings.effort} onChange={(e) => assistant.setSettings({ effort: e.target.value as Effort })}>
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {EFFORT_LABELS[e]}
            </option>
          ))}
        </select>
        <select data-testid="assistant-permission" aria-label="How much Claude may do on its own" value={settings.permission} onChange={(e) => assistant.setSettings({ permission: e.target.value as Permission })} title={PERMISSION_LABELS[settings.permission].help}>
          {PERMISSIONS.map((p) => (
            <option key={p} value={p}>
              {PERMISSION_LABELS[p].label}
            </option>
          ))}
        </select>
        <button data-testid="assistant-new" onClick={() => void assistant.newChat()} title="Forget this conversation and start again">
          New chat
        </button>
      </div>
      <KeyBox />
      <details className="more">
        <summary>More settings</summary>
        <label className="check">
          <input type="checkbox" data-testid="assistant-fallback" checked={settings.fallback} onChange={(e) => assistant.setSettings({ fallback: e.target.checked })} /> If Claude declines a request, let Anthropic try another model instead
        </label>
        <label className="field">
          <span>Most one question may cost (US dollars, 0 for no limit)</span>
          <input data-testid="assistant-limit" type="number" min={0} step={0.5} value={settings.runLimit} onChange={(e) => assistant.setSettings({ runLimit: Number(e.target.value) })} />
        </label>
        <ProviderKeys />
      </details>
      <NotesBox />
      <div className="chat" data-testid="chat">
        {items.length === 0 && (
          <p className="hint" data-testid="chat-empty">
            Ask a question, press Explain or Fix with Claude next to a problem, or describe something to build. Claude shows every change it wants to make and waits for you to approve it; each approved change is one undo step.
          </p>
        )}
        {items.map((i) => (
          <Item key={i.id} item={i} />
        ))}
        {busy && (
          <div className="working" data-testid="assistant-working">
            Claude is working...
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="notice warn" role="alert" data-testid="assistant-error">
          {error.message}{' '}
          {error.retryable && (
            <button data-testid="assistant-retry" onClick={() => void assistant.retry()}>
              Retry
            </button>
          )}
        </div>
      )}
      <div className="modes" role="group" aria-label="What kind of help">
        {MODES.map((m) => (
          <button key={m} data-testid={`mode-${m}`} aria-pressed={mode === m} className={mode === m ? 'on' : ''} title={MODE_HINTS[m]} onClick={() => assistant.setMode(m)}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {attachments.length > 0 && (
        <div className="attachments" data-testid="attachments">
          {attachments.map((a, i) => (
            <span key={i} className="attachment">
              <img src={a.url} alt={a.name} title={a.name} style={{ maxWidth: 48, maxHeight: 48 }} />
              <button aria-label={`Remove ${a.name}`} data-testid={`attachment-remove-${i}`} onClick={() => assistant.removeAttachment(i)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className="row compose"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          void assistant.attach([...e.dataTransfer.files]);
        }}
      >
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          data-testid="assistant-file"
          onChange={(e) => {
            void assistant.attach([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <button data-testid="assistant-attach" title={`Attach a picture (up to ${MAX_ATTACHMENTS}): drop one here, paste one, or choose a file`} onClick={() => picker.current?.click()}>
          📎
        </button>
        <textarea
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((x) => x.type.startsWith('image/'));
            if (files.length > 0) {
              e.preventDefault();
              void assistant.attach(files);
            }
          }}
          data-testid="assistant-input"
          rows={3}
          placeholder={MODE_HINTS[mode]}
          value={draft}
          onChange={(e) => assistant.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Message to Claude"
        />
        {busy ? (
          <button data-testid="assistant-stop" onClick={() => void assistant.cancel()}>
            Stop
          </button>
        ) : (
          <button data-testid="assistant-send" className="primary" disabled={!draft.trim()} onClick={submit}>
            Send
          </button>
        )}
      </div>
      <div className="usage" data-testid="assistant-usage" title="Estimated from list prices. Cached tokens are billed at a fraction of normal input.">
        {usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens === 0
          ? 'No tokens used in this conversation yet.'
          : `This conversation: ${(usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens).toLocaleString()} tokens in (${usage.cacheReadTokens.toLocaleString()} from cache), ${usage.outputTokens.toLocaleString()} out, about ${formatCost(cost)}`}
      </div>
      {run.tokens > 0 && (
        <div className="usage" data-testid="assistant-run-usage" title="What the last question (and everything Claude did to answer it) has cost. Claude stops when it reaches the limit in the settings.">
          This question: about {formatCost(run.cost)}
          {settings.runLimit > 0 ? ` of the ${formatCost(settings.runLimit)} you allow` : ' (no limit set)'}
        </div>
      )}
    </div>
  );
}
