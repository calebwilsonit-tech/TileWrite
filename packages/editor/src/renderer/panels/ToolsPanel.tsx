import { SLOPE, type SlopeDir } from '@tilewright/runtime';
import { useApp, store, type ToolId, type ToolOptions } from '../app/store';
import { describeKeys } from '../app/commands';
import { allPrefabs, attachmentSprites, prefabById } from '../tools/prefabs';
import { useStudio } from '../studio/store';
import { TOOL_META, toolMeta, type ToolMeta } from '../tools/tools';
import { host } from '@tilewright/behaviors';
import { usePlugins } from '../plugins/hooks';

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

/** Nine tiles on keys 1 to 9: the ones used lately for blocks. */
function Hotbar({ options }: { options: ToolOptions }) {
  const tiles = useApp((s) => s.project?.project.tileset) ?? [];
  const names = (id: number): string => tiles.find((t) => t.id === id)?.name ?? DEFAULT_NAMES[id] ?? String(id);
  return (
    <div className="opt hotbar" data-testid="hotbar" role="group" aria-label="Hotbar of block tiles">
      <span>Hotbar (keys 1 to 9)</span>
      <div className="seg">
        {options.hotbar.map((id, i) => (
          <button key={`${i}-${id}`} data-testid={`hotbar-${i + 1}`} className={options.tile === id ? 'on' : ''} title={names(id)} onClick={() => store.setOptions({ tile: id })}>
            {i + 1} {names(id)}
          </button>
        ))}
      </div>
    </div>
  );
}

const DEFAULT_NAMES: Record<number, string> = { 1: 'grass', 2: 'stone', 3: 'sand', 4: 'water', 5: 'brick', 6: 'wood' };

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
          <p className="hint">Right-click or Ctrl+click always removes, Alt+click always changes the tile. Blocks of a plain column appear as you edit them.</p>
        </div>
      )}
      {meta.options.includes('blockShape') && (
        <div className="opt" data-testid="block-shape-options">
          <span>Next block is</span>
          <div className="seg" role="group" aria-label="Shape of the next block">
            {(
              [
                ['cube', 'a whole block'],
                ['stairs', 'stairs'],
                ['ramp', 'a ramp'],
              ] as const
            ).map(([shape, label]) => (
              <button key={shape} data-testid={`block-shape-${shape}`} className={options.blockShape === shape ? 'on' : ''} onClick={() => set({ blockShape: shape })}>
                {label}
              </button>
            ))}
          </div>
          {options.blockShape !== 'cube' && (
            <>
              <span>Rises toward (R turns)</span>
              <div className="seg" role="group" aria-label="Way the stairs rise">
                {(['north', 'east', 'south', 'west'] as const).map((name, i) => (
                  <button key={name} data-testid={`block-rot-${i}`} className={options.blockRot === i ? 'on' : ''} onClick={() => set({ blockRot: i as 0 | 1 | 2 | 3 })}>
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
          <label className="opt check">
            <input data-testid="block-solid" type="checkbox" checked={!options.blockSolid} onChange={(e) => set({ blockSolid: !e.target.checked })} />
            <span>Not solid (bodies walk through it)</span>
          </label>
          {meta.options.includes('blockHeight') && <Slider testId="opt-block-height" label="Shift-drag builds this many layers" value={options.blockHeight} min={1} max={12} onChange={(v) => set({ blockHeight: v })} />}
        </div>
      )}
      {meta.options.includes('hotbar') && <Hotbar options={options} />}
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
  usePlugins();
  const pluginTools = [...host.editor.tools.values()];
  return (
    <div className="panel tools-panel" data-testid="tools-panel">
      {GROUPS.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <div className="tool-grid">
            {TOOL_META.filter((t) => t.group === g && t.id !== 'plugin').map((t) => {
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
      {pluginTools.length > 0 && (
        <section data-testid="plugin-tools">
          <h3>Plugins</h3>
          <div className="tool-grid">
            {pluginTools.map((t) => (
              <button
                key={t.id}
                data-testid={`plugin-tool-${t.id}`}
                className={`tool${tool === 'plugin' && options.pluginTool === t.id ? ' on' : ''}`}
                title={t.help ?? t.label}
                aria-pressed={tool === 'plugin' && options.pluginTool === t.id}
                onClick={() => {
                  store.setOptions({ pluginTool: t.id });
                  store.set({ tool: 'plugin' });
                }}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <ToolOptionsView tool={tool} options={options} />
    </div>
  );
}
