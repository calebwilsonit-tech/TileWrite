import { SLOPE, type SlopeDir } from '@tilewright/runtime';
import { useApp, store, type ToolId, type ToolOptions } from '../app/store';
import { describeKeys } from '../app/commands';
import { allPrefabs, prefabById } from '../tools/prefabs';
import { TOOL_META, toolMeta, type ToolMeta } from '../tools/tools';

const GROUPS: ToolMeta['group'][] = ['Select', 'Paint', 'Height', 'Terrain', 'Collision', 'Objects', 'Logic', 'Helpers'];

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
  const choices = allPrefabs(store.prefabs);
  const groups = [...new Set(choices.map((c) => c.group))];
  const set = (p: Partial<ToolOptions>): void => store.setOptions(p);
  return (
    <div className="tool-options" data-testid="tool-options">
      <p className="hint">{meta.hint}</p>
      {meta.options.includes('size') && <Slider testId="opt-size" label="Brush size" value={options.size} min={1} max={9} onChange={(v) => set({ size: v })} />}
      {meta.options.includes('height') && <Slider testId="opt-height" label="Height level" value={options.height} min={0} max={12} onChange={(v) => set({ height: v })} />}
      {meta.options.includes('density') && <Slider testId="opt-density" label="Density" value={options.density} min={0.05} max={1} step={0.05} onChange={(v) => set({ density: v })} />}
      {meta.options.includes('bridgeLevel') && <Slider testId="opt-bridge" label="Bridge level" value={options.bridgeLevel} min={1} max={12} onChange={(v) => set({ bridgeLevel: v })} />}
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
