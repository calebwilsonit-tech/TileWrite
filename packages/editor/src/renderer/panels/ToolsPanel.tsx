import { SLOPE, type SlopeDir } from '@tilewright/runtime';
import { useApp, store, type ToolId, type ToolOptions } from '../app/store';
import { describeKeys } from '../app/commands';
import { allPrefabs, attachmentSprites, prefabById } from '../tools/prefabs';
import { useStudio } from '../studio/store';
import { TOOL_META, toolMeta, type ToolMeta } from '../tools/tools';

const GROUPS: ToolMeta['group'][] = ['Select', 'Paint', 'Height', 'Blocks', 'Terrain', 'Collision', 'Objects', 'Logic', 'Helpers'];

const DIRS: { dir: SlopeDir; label: string; arrow: string }[] = [
  { dir: SLOPE.N, label: 'North (up-right on screen)', arrow: '↗' },
  { dir: SLOPE.E, label: 'East (down-right on screen)', arrow: '↘' },
  { dir: SLOPE.S, label: 'South (down-left on screen)', arrow: '↙' },
  { dir: SLOPE.W, label: 'West (up-left on screen)', arrow: '↖' },
];

const EDGES = [
  { bit: 1, label: 'North side', short: 'N' },
  { bit: 2, label: 'East side', short: 'E' },
  { bit: 4, label: 'South side', short: 'S' },
  { bit: 8, label: 'West side', short: 'W' },
];

function Slider({ label, value, min, max, step = 1, onChange, testId }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; testId: string }) {
  return (
    <label className="opt">
      <span>{label}</span>
      <input data-testid={testId} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{step < 1 ? value.toFixed(2) : value}</output>
    </label>
  );
}

export function ToolOptionsView({ tool, options }: { tool: ToolId; options: ToolOptions }) {
  const meta = toolMeta(tool);
  useApp((s) => s.prefabNames);
  useStudio((s) => s.assetsVersion);
  const choices = allPrefabs(store.prefabs);
  const attachments = attachmentSprites();
  const groups = [...new Set(choices.map((c) => c.group))];
  const set = (p: Partial<ToolOptions>): void => store.setOptions(p);
  return (
    <div className="tool-options" data-testid="tool-options">
      <p className="hint">{meta.hint}</p>
      {meta.options.includes('size') && <Slider testId="opt-size" label="Brush size" value={options.size} min={1} max={9} onChange={(v) => set({ size: v })} />}
      {meta.options.includes('height') && <Slider testId="opt-height" label="Height level" value={options.height} min={0} max={12} onChange={(v) => set({ height: v })} />}
      {meta.options.includes('density') && <Slider testId="opt-density" label="Density" value={options.density} min={0.05} max={1} step={0.05} onChange={(v) => set({ density: v })} />}
      {meta.options.includes('zFrom') && <Slider testId="opt-zfrom" label="Box from level" value={options.zFrom} min={0} max={20} onChange={(v) => set({ zFrom: v, zTo: Math.max(v, options.zTo) })} />}
      {meta.options.includes('zTo') && <Slider testId="opt-zto" label="Box up to level" value={options.zTo} min={0} max={20} onChange={(v) => set({ zTo: v, zFrom: Math.min(v, options.zFrom) })} />}
      {meta.options.includes('spacing') && <Slider testId="opt-spacing" label="Spacing (cells)" value={options.spacing} min={0} max={8} step={0.5} onChange={(v) => set({ spacing: v })} />}
      {meta.options.includes('avoidPaths') && (
        <label className="opt check">
          <input data-testid="opt-avoid-paths" type="checkbox" checked={options.avoidPaths} onChange={(e) => set({ avoidPaths: e.target.checked })} />
          <span>Keep off paths and roads</span>
        </label>
      )}
      {meta.options.includes('attachment') && (
        <div className="opt">
          <span>Attachment</span>
          <select data-testid="opt-attachment" value={options.attachment} onChange={(e) => set({ attachment: e.target.value })}>
            <option value="">{attachments.length ? '(choose one)' : '(none yet: draw one in the Tile studio)'}</option>
            {attachments.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {meta.options.includes('bridgeLevel') && <Slider testId="opt-bridge" label="Bridge level" value={options.bridgeLevel} min={1} max={12} onChange={(v) => set({ bridgeLevel: v })} />}
      {meta.options.includes('blockTo') && (
        <>
          <label className="opt check">
            <input data-testid="opt-block-all" type="checkbox" checked={options.blockTo === 0} onChange={(e) => set(e.target.checked ? { blockFrom: 0, blockTo: 0 } : { blockFrom: 0, blockTo: Math.max(1, options.blockTo || 2) })} />
            <span>Blocks at every height</span>
          </label>
          {options.blockTo > 0 && (
            <>
              <Slider testId="opt-block-from" label="Blocks from level" value={options.blockFrom} min={0} max={Math.max(0, options.blockTo - 1)} onChange={(v) => set({ blockFrom: v })} />
              <Slider testId="opt-block-to" label="Up to (not including) level" value={options.blockTo} min={1} max={12} onChange={(v) => set({ blockTo: v, blockFrom: Math.min(options.blockFrom, v - 1) })} />
              <p className="hint">Things whose feet and body are outside these levels walk through. Bridges and decks above the top pass over it.</p>
            </>
          )}
        </>
      )}
      {meta.options.includes('blockMode') && (
        <div className="opt">
          <span>A click...</span>
          <div className="seg" role="group" aria-label="What a click does to a block">
            {(
              [
                ['add', 'adds a block'],
                ['replace', 'changes the tile'],
                ['face', 'paints one face'],
                ['delete', 'removes it'],
              ] as const
            ).map(([mode, label]) => (
              <button key={mode} data-testid={`block-mode-${mode}`} className={options.blockMode === mode ? 'on' : ''} onClick={() => set({ blockMode: mode })}>
                {label}
              </button>
            ))}
          </div>
          <p className="hint">Shift+click always removes, Alt+click always changes the tile. Blocks of a plain column appear as you edit them.</p>
        </div>
      )}
      {meta.options.includes('outline') && (
        <label className="opt check">
          <input data-testid="opt-outline" type="checkbox" checked={options.outline} onChange={(e) => set({ outline: e.target.checked })} />
          <span>Outline only</span>
        </label>
      )}
      {meta.options.includes('slopeDir') && (
        <div className="opt">
          <span>Climbs toward (R turns)</span>
          <div className="seg" role="group" aria-label="Direction the stairs climb">
            {DIRS.map((d) => (
              <button key={d.dir} data-testid={`dir-${d.dir}`} className={options.slopeDir === d.dir ? 'on' : ''} title={d.label} aria-label={d.label} onClick={() => set({ slopeDir: d.dir })}>
                {d.arrow}
              </button>
            ))}
          </div>
        </div>
      )}
      {meta.options.includes('edge') && (
        <div className="opt">
          <span>Edge that cannot be entered</span>
          <div className="seg" role="group" aria-label="Edge">
            {EDGES.map((e) => (
              <button key={e.bit} className={options.edge === e.bit ? 'on' : ''} title={e.label} onClick={() => set({ edge: e.bit })}>
                {e.short}
              </button>
            ))}
          </div>
        </div>
      )}
      {meta.options.includes('prefab') && (
        <div className="opt">
          <span>Object to place</span>
          <select data-testid="opt-prefab" value={options.prefab} onChange={(e) => set({ prefab: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {choices
                  .filter((c) => c.group === g)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <p className="hint">{prefabById(options.prefab, store.prefabs).hint}</p>
        </div>
      )}
    </div>
  );
}

export function ToolsPanel() {
  const tool = useApp((s) => s.tool);
  const options = useApp((s) => s.options);
  const locks = useApp((s) => s.locks);
  return (
    <div className="panel tools-panel" data-testid="tools-panel">
      {GROUPS.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <div className="tool-grid">
            {TOOL_META.filter((t) => t.group === g).map((t) => {
              const locked = (t.edits === 'ground' && locks.ground) || (t.edits === 'objects' && locks.objects) || (t.edits === 'regions' && locks.regions);
              return (
                <button
                  key={t.id}
                  data-testid={`tool-${t.id}`}
                  className={`tool${tool === t.id ? ' on' : ''}${locked ? ' locked' : ''}`}
                  title={`${t.hint}${t.hotkey ? ` (${describeKeys(t.hotkey)})` : ''}`}
                  aria-pressed={tool === t.id}
                  onClick={() => store.set({ tool: t.id })}
                >
                  <span>{t.label}</span>
                  {t.hotkey && <kbd>{t.hotkey}</kbd>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <ToolOptionsView tool={tool} options={options} />
    </div>
  );
}
