import {
  C,
  addItem,
  autoSlot,
  facingOfGridDir,
  findPath,
  isGravityDir,
  isLit,
  itemCount,
  teleportBody,
  type Body,
  type Entity,
  type SimContext,
  type Sprite,
  type TransformIso,
  type VariableValue,
} from '@tilewright/runtime';
import { actionDef, conditionDef, resolveRef } from '../events/sheet';
import { defineBehavior, getBehavior, behaviorList, stateOf, undefineBehavior, type BehaviorDef, type FieldSpec, type Phase, type SignalSpec } from '../framework';
import { damage, heal } from '../builtins/combat';
import { blockAtCell, breakBlock, placeBlock } from '../builtins/blocks';
import { newNav, steerTo, type NavState } from '../builtins/ai';
import { input as signalInput, output as signalOutput, setOutput } from '../signals';
import { spawnPrefabAt } from '../builtins/world';
import { beginDialogue, playCutscene } from '../story/director';
import type { ScriptDef, ScriptEntity, ScriptGame, ScriptSettingSpec, ScriptValue } from './api';

/** Where a script's messages and breakpoint hits go (the editor's Console and debugger, or a game's log). */
export interface ScriptHooks {
  log(kind: 'log' | 'warn' | 'error', text: string): void;
  /** A line with a breakpoint was reached. */
  onBreak?(hit: { script: string; file: string; line: number; me: ScriptEntity; game: ScriptGame }): void;
  /** Turn a line number in the running (transpiled) code into the line in the author's source. */
  mapLine?(file: string, line: number): number;
}

export const SCRIPT_PREFIX = 'script_';

export function scriptId(name: string): string {
  return SCRIPT_PREFIX + name.replace(/[^A-Za-z0-9_]/g, '_');
}

function specOf(v: ScriptValue | ScriptSettingSpec): ScriptSettingSpec {
  return typeof v === 'object' && v !== null ? v : { value: v };
}

const titleOf = (key: string): string => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The Inspector's view of a script's settings. */
export function settingFields(settings: ScriptDef['settings']): { fields: FieldSpec[]; defaults: Record<string, ScriptValue> } {
  const fields: FieldSpec[] = [];
  const defaults: Record<string, ScriptValue> = {};
  for (const [key, raw] of Object.entries(settings ?? {})) {
    const s = specOf(raw);
    defaults[key] = s.value;
    const base = { key, label: s.label ?? titleOf(key), help: s.help };
    if (s.options && s.options.length > 0) fields.push({ ...base, type: 'select', options: s.options.map((o) => ({ value: o, label: o })) });
    else if (typeof s.value === 'number') fields.push({ ...base, type: 'number', min: s.min, max: s.max, step: s.step ?? (Number.isInteger(s.value) ? 1 : 0.1) });
    else if (typeof s.value === 'boolean') fields.push({ ...base, type: 'boolean' });
    else fields.push({ ...base, type: 'text' });
  }
  return { fields, defaults };
}

// ---------- the object, as a script sees it ----------

class EntityView implements ScriptEntity {
  constructor(
    readonly entity: Entity,
    private readonly ctx: SimContext,
    private readonly behaviourId: string,
    private readonly settingsObj: Record<string, unknown>,
    private readonly stateObj: Record<string, unknown>,
  ) {}

  get id(): number {
    return this.entity.id;
  }
  get name(): string {
    return this.entity.name;
  }
  set name(v: string) {
    this.entity.name = v;
  }
  get tags(): Set<string> {
    return this.entity.tags;
  }
  get alive(): boolean {
    return this.entity.alive;
  }
  private get t(): TransformIso {
    return this.entity.require<TransformIso>(C.Transform);
  }
  get x(): number {
    return this.t.x;
  }
  set x(v: number) {
    this.t.x = v;
  }
  get y(): number {
    return this.t.y;
  }
  set y(v: number) {
    this.t.y = v;
  }
  get h(): number {
    return this.t.h;
  }
  set h(v: number) {
    this.t.h = v;
  }
  get facing(): number {
    return this.t.facing;
  }
  set facing(v: number) {
    this.t.facing = ((Math.round(v) % 8) + 8) % 8;
  }
  private get sprite(): Sprite | undefined {
    return this.entity.get<Sprite>(C.Sprite);
  }
  get visible(): boolean {
    return this.sprite?.visible ?? false;
  }
  set visible(v: boolean) {
    if (this.sprite) this.sprite.visible = v;
  }
  get alpha(): number {
    return this.sprite?.alpha ?? 1;
  }
  set alpha(v: number) {
    if (this.sprite) this.sprite.alpha = v;
  }
  get color(): number {
    return this.sprite?.color ?? 0;
  }
  set color(v: number) {
    if (this.sprite) this.sprite.color = v;
  }
  get settings(): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.settingsObj;
  }
  get state(): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.stateObj;
  }
  hasTag(tag: string): boolean {
    return this.entity.tags.has(tag);
  }
  get<T = unknown>(component: string): T | undefined {
    return this.entity.get<T>(component);
  }
  set(component: string, data: unknown): void {
    this.entity.set(component, data);
  }
  destroy(): void {
    this.ctx.world.destroy(this.entity);
  }
  moveTo(x: number, y: number, h?: number): void {
    teleportBody(this.ctx, this.entity, x, y, h);
  }
  walkTo(x: number, y: number, speed: number): boolean {
    const nav = (this.stateObj.__nav ??= newNav()) as NavState;
    return steerTo(this.ctx, this.entity, { x, y }, speed, nav, 0.15) === 'arrived';
  }
  distanceTo(target: ScriptEntity | { x: number; y: number }): number {
    return Math.hypot(target.x - this.x, target.y - this.y);
  }
  lookAt(target: ScriptEntity | { x: number; y: number }): void {
    this.t.facing = facingOfGridDir(target.x - this.x, target.y - this.y);
  }
  get gravity(): string {
    const b = this.entity.get<Body>(C.Body);
    return b?.g ?? b?.gdir ?? this.ctx.runtime.gravity;
  }
  set gravity(dir: string) {
    const b = this.entity.get<Body>(C.Body);
    if (b && isGravityDir(dir)) b.gdir = dir;
  }
  input(name: string): boolean {
    return signalInput(this.entity, name);
  }
  output(name: string, on: boolean): void {
    setOutput(this.entity, name, on);
  }
  isOutputOn(name: string): boolean {
    return signalOutput(this.entity, name);
  }
  /** Used for errors: which script this is. */
  get script(): string {
    return this.behaviourId;
  }
}

// ---------- the game, as a script sees it ----------

class GameView implements ScriptGame {
  private readonly views = new Map<Entity, EntityView>();

  constructor(
    private readonly ctx: SimContext,
    private readonly current: Entity,
    private readonly hooks: ScriptHooks,
  ) {}

  /** A script-side object for any entity (the same object each time within one update). */
  view(e: Entity): ScriptEntity {
    let v = this.views.get(e);
    if (!v) {
      v = new EntityView(e, this.ctx, '', {}, stateOf<Record<string, unknown>>(e, 'scriptScratch', () => ({})));
      this.views.set(e, v);
    }
    return v;
  }

  registerView(e: Entity, v: EntityView): void {
    this.views.set(e, v);
  }

  get time(): number {
    return this.ctx.tick * this.ctx.dt;
  }
  get dt(): number {
    return this.ctx.dt;
  }
  get tick(): number {
    return this.ctx.tick;
  }
  get player(): ScriptEntity | undefined {
    const p = this.ctx.world.withTag('player')[0];
    return p ? this.view(p) : undefined;
  }
  get vars(): Record<string, VariableValue> {
    return this.ctx.runtime.vars;
  }
  random(): number {
    return this.ctx.rng.next();
  }
  randomInt(min: number, max: number): number {
    return this.ctx.rng.int(min, max);
  }
  find(ref: string, picked?: ScriptEntity): ScriptEntity | undefined {
    return this.findAll(ref, picked)[0];
  }
  findAll(ref: string, picked?: ScriptEntity): ScriptEntity[] {
    return resolveRef(this.ctx, ref, picked ? this.entityOf(picked) : undefined).map((e) => this.view(e));
  }
  spawn(prefab: string, x: number, y: number, h = 0): ScriptEntity | undefined {
    const e = spawnPrefabAt(this.ctx, this.current, prefab, x, y, h, `script${this.ctx.tick}`);
    return e ? this.view(e) : undefined;
  }
  say(text: string): void {
    this.ctx.events.emit('message', { text });
  }
  log(...values: unknown[]): void {
    this.hooks.log('log', values.map((v) => (typeof v === 'string' ? v : safeJson(v))).join(' '));
  }
  private entityOf(t: ScriptEntity): Entity | undefined {
    return this.ctx.world.get(t.id);
  }
  damage(target: ScriptEntity, amount: number): boolean {
    const e = this.entityOf(target);
    return e ? damage(this.ctx, e, amount, { source: this.current }) : false;
  }
  heal(target: ScriptEntity, amount: number): void {
    const e = this.entityOf(target);
    if (e) heal(this.ctx, e, amount);
  }
  itemCount(item: string): number {
    return itemCount(this.ctx.runtime.vars, item);
  }
  giveItem(item: string, amount = 1): number {
    const got = addItem(this.ctx.runtime.vars, item, amount, this.ctx.assets.items.get(item));
    if (got > 0) autoSlot(this.ctx.runtime.vars, item);
    this.ctx.events.emit(amount >= 0 ? 'item-given' : 'item-taken', { item, amount: got });
    return got;
  }
  startDialogue(name: string): boolean {
    return beginDialogue(this.ctx, name);
  }
  playCutscene(name: string): boolean {
    return playCutscene(this.ctx, name);
  }
  travel(scene: string, spawn = ''): void {
    if (!this.ctx.runtime.travel) this.ctx.runtime.travel = { scene: scene || this.ctx.runtime.scene, spawn };
  }
  isLit(x: number, y: number): boolean {
    return isLit(this.ctx.runtime.lighting, x, y);
  }
  findPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] | null {
    const map = this.ctx.map;
    return map ? findPath(map, from, to, { maxNodes: 6000 }) : null;
  }
  get input(): ScriptGame['input'] {
    const i = this.ctx.input;
    return { pressed: (a) => i.pressed(a), down: (a) => i.down(a), released: (a) => i.released(a) };
  }
  get gravity(): string {
    return this.ctx.runtime.gravity;
  }
  set gravity(dir: string) {
    if (isGravityDir(dir)) this.ctx.runtime.gravity = dir;
  }
  setBlock(x: number, y: number, z: number, tile: string, shape = 'cube', rot = 0): boolean {
    const r = placeBlock(this.ctx, { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), tile, shape: shape === 'stairs' || shape === 'ramp' ? shape : 'cube', rot: (Math.floor(rot) & 3) as 0 | 1 | 2 | 3 });
    if (!r.ok) this.hooks.log('warn', r.why);
    return r.ok;
  }
  breakBlock(x: number, y: number, z: number): boolean {
    const r = breakBlock(this.ctx, Math.floor(x), Math.floor(y), Math.floor(z));
    if (!r.ok) this.hooks.log('warn', r.why);
    return r.ok;
  }
  blockAt(x: number, y: number, z: number): { tile: string; shape: string; solid: boolean } | undefined {
    const b = blockAtCell(this.ctx, Math.floor(x), Math.floor(y), Math.floor(z));
    return b ? { tile: b.name, shape: b.shape ?? 'cube', solid: b.solid !== false } : undefined;
  }
  emit(type: string, data: Record<string, unknown> = {}): void {
    this.ctx.events.emit(type, data);
  }
  eventsOf(type: string): Record<string, unknown>[] {
    return this.ctx.events.of(type);
  }
  do(action: string, params: Record<string, unknown> = {}, picked?: ScriptEntity): void {
    const def = actionDef(action);
    if (!def) throw new Error(`There is no event action called "${action}".`);
    const full = { ...Object.fromEntries(def.params.map((p) => [p.key, p.default])), ...params };
    def.run(this.ctx, full, { picked: picked ? this.entityOf(picked) : this.current });
  }
  test(condition: string, params: Record<string, unknown> = {}, picked?: ScriptEntity): boolean {
    const def = conditionDef(condition);
    if (!def) throw new Error(`There is no event condition called "${condition}".`);
    const full = { ...Object.fromEntries(def.params.map((p) => [p.key, p.default])), ...params };
    return def.test(this.ctx, full, { picked: picked ? this.entityOf(picked) : this.current });
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** A script-side game object for use outside a behaviour (the debugger's watch window, tests). */
export function gameViewOf(ctx: SimContext, current: Entity, hooks: ScriptHooks): ScriptGame & { view(e: Entity): ScriptEntity } {
  return new GameView(ctx, current, hooks);
}

// ---------- turning a script into a behaviour ----------

interface ScriptState {
  started: boolean;
  data: Record<string, unknown>;
  seenEvents: number;
  seenTick: number;
}

/** The script that is running right now, for breakpoints and the debugger. */
export const running: { current: { script: string; file: string; me: ScriptEntity; game: ScriptGame; hooks: ScriptHooks } | null } = { current: null };

/** Make a loaded script a behaviour (so it shows in the Add menu, has Inspector fields, wires, and runs every tick). */
export function registerScript(file: string, def: ScriptDef, hooks: ScriptHooks): BehaviorDef {
  const display = def.name?.trim() || file.replace(/^.*[\\/]/, '').replace(/\.script\.(ts|js)$/, '');
  const id = scriptId(display);
  const { fields, defaults } = settingFields(def.settings);
  const sig = (names: string[] | undefined): SignalSpec[] => (names ?? []).map((n) => ({ name: n, label: titleOf(n) }));
  /** Run one of the script's functions; if it throws, say which script, which line and what. */
  const call = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const m = /(?:<anonymous>|blob:[^\s)]*|data:[^\s)]*):(\d+):\d+/.exec(err.stack ?? '');
      const raw = m ? Number(m[1]) : 0;
      const line = raw > 0 ? (hooks.mapLine?.(file, raw) ?? raw) : 0;
      throw new Error(`The script "${display}" failed${line > 0 ? ` at line ${line}` : ''} (${what}): ${err.message}`, { cause: e });
    }
  };
  const run = (ctx: SimContext, e: Entity, st: ScriptState, me: EntityView, game: GameView): void => {
    if (!st.started) {
      st.started = true;
      if (def.start) call('start', () => def.start!(me, game));
    }
    if (def.onEvent) {
      if (st.seenTick !== ctx.tick) {
        st.seenTick = ctx.tick;
        st.seenEvents = 0;
      }
      const recent = ctx.events.recent;
      for (; st.seenEvents < recent.length; st.seenEvents++) {
        const ev = recent[st.seenEvents]!;
        if (ev.type !== 'message') call(`onEvent ${ev.type}`, () => def.onEvent!(ev.type, { ...ev }, me, game));
      }
    }
    if (def.update) call('update', () => def.update!(me, game));
    void e;
  };
  return defineBehavior<Record<string, ScriptValue>>({
    id,
    name: display,
    category: 'Scripts',
    description: def.description ?? `A script written in code (${file}).`,
    phase: (def.phase ?? 'control') as Phase,
    defaults,
    fields,
    inputs: sig(def.inputs),
    outputs: sig(def.outputs),
    requires: {},
    summary: () => `Runs the script "${display}".`,
    update(ctx, e, settings) {
      const st = stateOf<ScriptState>(e, id, () => ({ started: false, data: {}, seenEvents: 0, seenTick: -1 }));
      const game = new GameView(ctx, e, hooks);
      const me = new EntityView(e, ctx, id, settings as Record<string, unknown>, st.data);
      game.registerView(e, me);
      const prev = running.current;
      running.current = { script: display, file, me, game, hooks };
      try {
        run(ctx, e, st, me, game);
      } finally {
        running.current = prev;
      }
    },
  });
}
/** Remove every behaviour that came from a script. */
export function clearScripts(): void {
  for (const b of behaviorList()) if (b.id.startsWith(SCRIPT_PREFIX)) undefineBehavior(b.id);
}

export function isScriptBehavior(id: string): boolean {
  return id.startsWith(SCRIPT_PREFIX) && getBehavior(id) !== undefined;
}

export type { Body };
