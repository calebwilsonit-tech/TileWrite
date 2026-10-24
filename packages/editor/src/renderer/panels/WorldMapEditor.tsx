import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { host } from '@tilewright/behaviors';
import { MAP_HEIGHT, MAP_ICONS, MAP_WIDTH, checkWorldMap, type MapNode, type MapUnlock } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { addLink, addPlace, hasLink, mapFromScenes, movePlace, neighboursOf, removeLink, removePlace, renamePlaceId, sceneLabel, updatePlace } from '../model/worldmap-edit';
import { CheckField, NumberField, SelectField, TextField } from './fields';

const GLYPHS: Record<string, string> = { pin: '●', town: '⌂', dungeon: '☠', cave: '◓', forest: '♣', tower: '♜', castle: '♛', camp: '▲', harbor: '⚓' };
/** The ways a place can unlock: the core's, then those the plugins that are on brought. */
const unlocks = (): { value: string; label: string }[] => [
  { value: 'visited', label: 'once the player has been there' },
  { value: 'always', label: 'from the start' },
  { value: 'variable', label: 'when a flag or counter is set' },
  ...[...host.ext.unlockRules.values()].map((r) => ({ value: r.id, label: r.label })),
];

type Drag = { id: string; dx: number; dy: number } | { link: string; x: number; y: number } | null;

/**
 * The world map as a board: a circle for every place, dashed lines for the paths. Drag a place to move it, drag from the
 * small dot beside it to another place to join them, click a place to edit it below. The player sees this board, with
 * places they cannot reach yet drawn as question marks, when they press M or choose Map in the pause menu.
 */
export function WorldMapEditor() {
  useApp((s) => s.storyVersion);
  const map = store.worldMap;
  const scenes = store.state.project?.project.scenes ?? [];
  const svg = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [linkTo, setLinkTo] = useState('');
  const [newScene, setNewScene] = useState('');
  const [big, setBig] = useState(false);
  const problems = useMemo(() => (map ? checkWorldMap(map, scenes) : []), [map, scenes]);

  if (!map) {
    return (
      <div className="story-body" data-testid="worldmap-tab">
        <p className="hint">A world map shows the player the places of your game (a hub, villages, dungeons) and lets them travel between them from the pause menu or with M. Places the player has not reached yet show as question marks.</p>
        <div className="row">
          <button data-testid="worldmap-create" onClick={() => store.setWorldMap(mapFromScenes(scenes, store.state.project?.project.startScene))}>
            Make a map from my scenes
          </button>
        </div>
      </div>
    );
  }

  const toBoard = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * MAP_WIDTH, y: ((e.clientY - r.top) / r.height) * MAP_HEIGHT };
  };
  const placeAt = (p: { x: number; y: number }): MapNode | undefined => [...map.nodes].reverse().find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= 28);
  const node = sel ? map.nodes.find((n) => n.id === sel) : undefined;
  const put = (next = map): void => store.setWorldMap(next);

  const down = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    svg.current!.setPointerCapture(e.pointerId);
    const p = toBoard(e);
    const port = (e.target as Element).closest('[data-port]');
    if (port) {
      setDrag({ link: port.getAttribute('data-port')!, x: p.x, y: p.y });
      return;
    }
    const n = placeAt(p);
    if (n) {
      setSel(n.id);
      setDrag({ id: n.id, dx: p.x - n.x, dy: p.y - n.y });
    } else setSel(null);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    const p = toBoard(e);
    if ('link' in drag) setDrag({ ...drag, x: p.x, y: p.y });
    else store.worldMap = movePlace(map, drag.id, p.x - drag.dx, p.y - drag.dy); // live, saved when the drag ends
    if (!('link' in drag)) store.set({ storyVersion: store.state.storyVersion + 1 });
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    svg.current?.releasePointerCapture?.(e.pointerId);
    if ('link' in drag) {
      const to = placeAt(toBoard(e));
      if (to && to.id !== drag.link) put(addLink(map, drag.link, to.id));
    } else put(store.worldMap ?? map);
    setDrag(null);
  };

  return (
    <div className={big ? 'story-body dg-overlay' : 'story-body'} data-testid="worldmap-tab">
      <p className="hint">Drag a place to move it; drag from the dot beside a place to another place to draw a path; click a place to edit it. The player sees this map in the pause menu and with M.</p>
      <div className="row wrap">
        <TextField label="Title" testId="worldmap-title" value={map.title} onCommit={(v) => put({ ...map, title: v.trim() || 'Map' })} />
        <SelectField<string> label="Add a place for" testId="worldmap-add-scene" value={newScene} options={[{ value: '', label: '(choose a scene)' }, ...scenes.map((s) => ({ value: s, label: sceneLabel(s) }))]} onChange={setNewScene} />
        <button
          data-testid="worldmap-add"
          disabled={!newScene}
          onClick={() => {
            const r = addPlace(map, newScene);
            put(r.map);
            setSel(r.id);
            setNewScene('');
          }}
        >
          Add
        </button>
        <button className="small" data-testid="worldmap-big" onClick={() => setBig(!big)}>
          {big ? 'Make it smaller' : 'Make it bigger'}
        </button>
        <button
          className="small"
          data-testid="worldmap-remove"
          onClick={() => {
            if (window.confirm('Remove the world map? The M key goes back to the plain list of places.')) void store.removeWorldMap();
          }}
        >
          Remove the map
        </button>
      </div>
      <svg ref={svg} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} data-testid="worldmap-board" style={{ width: '100%', height: 'auto', background: '#2a2418', borderRadius: 8, border: '1px solid #6b5a3a', touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        {map.links.map((l) => {
          const a = map.nodes.find((n) => n.id === l.a);
          const b = map.nodes.find((n) => n.id === l.b);
          if (!a || !b) return null;
          return <line key={`${l.a}-${l.b}`} data-testid={`worldmap-link-${l.a}-${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel && (sel === l.a || sel === l.b) ? '#6aa8ff' : '#d9c6a0'} strokeWidth={3} strokeDasharray="10 7" opacity={0.7} />;
        })}
        {drag && 'link' in drag && (() => {
          const a = map.nodes.find((n) => n.id === drag.link);
          return a ? <line x1={a.x} y1={a.y} x2={drag.x} y2={drag.y} stroke="#fff" strokeWidth={3} strokeDasharray="4 4" /> : null;
        })()}
        {map.nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y})`} data-testid={`worldmap-place-${n.id}`} style={{ cursor: 'grab' }}>
            {sel === n.id && <circle r={32} fill="none" stroke="#6aa8ff" strokeWidth={4} />}
            <circle r={22} fill="#4a3b1e" stroke={n.unlock.kind === 'always' ? '#9cf29c' : '#ffd98a'} strokeWidth={3} opacity={n.hidden ? 0.55 : 1} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={22} fill="#ffd98a" style={{ pointerEvents: 'none' }}>
              {GLYPHS[n.icon] ?? GLYPHS.pin}
            </text>
            <text textAnchor="middle" y={44} fontSize={20} fill="#f4efe6" style={{ pointerEvents: 'none' }}>
              {n.label}
            </text>
            <circle data-port={n.id} data-testid={`worldmap-port-${n.id}`} cx={26} cy={18} r={7} fill="#6aa8ff" stroke="#fff" strokeWidth={1.5} style={{ cursor: 'crosshair' }} />
          </g>
        ))}
      </svg>
      {node && (
        <fieldset className="story-card" data-testid="worldmap-form">
          <legend>{node.label}</legend>
          <TextField label="Name on the map" testId="worldmap-label" value={node.label} onCommit={(v) => put(updatePlace(map, node.id, { label: v.trim() || node.label }))} />
          <TextField
            label="Id (letters, numbers, - and _)"
            testId="worldmap-id"
            value={node.id}
            onCommit={(v) => {
              const next = renamePlaceId(map, node.id, v.trim());
              if (next === map) return store.notify('warn', 'Place ids use letters, numbers, - and _, and each must be different.');
              put(next);
              setSel(v.trim());
            }}
          />
          <SelectField<string> label="Scene" testId="worldmap-scene" value={node.scene} options={[{ value: '', label: '(choose a scene)' }, ...scenes.map((s) => ({ value: s, label: `${sceneLabel(s)} (${s})` }))]} onChange={(v) => put(updatePlace(map, node.id, { scene: v }))} />
          <SelectField<string> label="Picture" testId="worldmap-icon" value={node.icon} options={MAP_ICONS.map((i) => ({ value: i, label: `${GLYPHS[i]} ${i}` }))} onChange={(v) => put(updatePlace(map, node.id, { icon: v as MapNode['icon'] }))} />
          <SelectField<string>
            label="The player can travel here"
            testId="worldmap-unlock"
            value={node.unlock.kind}
            options={unlocks()}
            onChange={(k) => put(updatePlace(map, node.id, { unlock: k === 'variable' ? { kind: 'variable', name: '', atLeast: 1 } : ({ kind: k } as MapUnlock) }))}
          />
          {node.unlock.kind === 'variable' && (
            <>
              <TextField label="Variable" testId="worldmap-var" value={(node.unlock as { name?: string }).name ?? ''} onCommit={(v) => put(updatePlace(map, node.id, { unlock: { kind: 'variable', name: v.trim(), atLeast: (node.unlock as { atLeast: number }).atLeast } }))} />
              <NumberField label="At least" value={(node.unlock as { atLeast?: number }).atLeast ?? 1} step={1} onCommit={(v) => put(updatePlace(map, node.id, { unlock: { kind: 'variable', name: (node.unlock as { name: string }).name, atLeast: v } }))} />
            </>
          )}
          <TextField label="Arrive at (an object's name or x,y; empty = the player start)" value={node.spawn} onCommit={(v) => put(updatePlace(map, node.id, { spawn: v.trim() }))} />
          <CheckField label="Not drawn at all until the player can travel here" testId="worldmap-hidden" value={node.hidden} onChange={(v) => put(updatePlace(map, node.id, { hidden: v }))} />
          <div className="row wrap">
            <SelectField<string> label="Path to" testId="worldmap-link-to" value={linkTo} options={[{ value: '', label: '(choose a place)' }, ...map.nodes.filter((n) => n.id !== node.id && !hasLink(map, node.id, n.id)).map((n) => ({ value: n.id, label: n.label }))]} onChange={setLinkTo} />
            <button data-testid="worldmap-link-add" disabled={!linkTo} onClick={() => { put(addLink(map, node.id, linkTo)); setLinkTo(''); }}>
              Add path
            </button>
          </div>
          {neighboursOf(map, node.id).map((o) => (
            <div className="row" key={o}>
              <span>Path to {map.nodes.find((n) => n.id === o)?.label ?? o}</span>
              <button className="small" data-testid={`worldmap-unlink-${o}`} onClick={() => put(removeLink(map, node.id, o))}>
                Remove
              </button>
            </div>
          ))}
          <button
            className="small"
            data-testid="worldmap-delete"
            onClick={() => {
              put(removePlace(map, node.id));
              setSel(null);
            }}
          >
            Delete this place
          </button>
        </fieldset>
      )}
      {problems.map((p) => (
        <p key={p} className="hint warn">
          {p}
        </p>
      ))}
      {problems.length === 0 && map.nodes.length > 0 && (
        <p className="hint ok" data-testid="worldmap-ok">
          No problems found.
        </p>
      )}
    </div>
  );
}
