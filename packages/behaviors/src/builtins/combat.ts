import {
  C,
  addImpact,
  emitFx,
  requestHitStop,
  screenIntentToGrid,
  teleportBody,
  type Body,
  type Entity,
  type SimContext,
  type Sprite,
  type TransformIso,
} from '@tilewright/runtime';
import { defineBehavior, settingsOf, stateOf } from '../framework';
import { input, setOutput } from '../signals';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);
const body = (e: Entity): Body | undefined => e.get<Body>(C.Body);

/** Unit vector in grid space for a facing index (0 = East, clockwise; see FACING_NAMES). */
export function facingVector(facing: number): { x: number; y: number } {
  const a = (facing * Math.PI) / 4;
  return screenIntentToGrid(Math.cos(a), Math.sin(a));
}

/** Flags that AI and bosses share so behaviours can cooperate without knowing about each other. */
export interface AiFlags {
  /** Another behaviour (chase, ...) is steering; patrol stays out of the way. */
  busy: boolean;
  /** Switched off (a boss in a room the player is not in, a dead enemy). */
  disabled: boolean;
  /** Multiplies movement speed (boss phases). */
  speedScale: number;
  /** Multiplies damage dealt (boss phases). */
  damageScale: number;
}

export function aiFlags(e: Entity): AiFlags {
  return stateOf<AiFlags>(e, 'aiFlags', () => ({ busy: false, disabled: false, speedScale: 1, damageScale: 1 }));
}

// ---------- health ----------

export type Team = 'auto' | 'player' | 'enemy' | 'neutral';
export type Hurts = 'player' | 'enemies' | 'anything';

export interface Health {
  max: number;
  /** Seconds of invulnerability after being hurt. */
  invulnerableSeconds: number;
  /** What happens at 0. */
  onDeath: 'remove' | 'respawn' | 'stay';
  /** Damage taken when falling into a pit (the object then returns to solid ground). */
  fallDamage: number;
  team: Team;
  showBar: boolean;
}

export interface HealthState {
  hp: number;
  iframes: number;
  dead: boolean;
  spawn: { x: number; y: number; h: number } | null;
  trail: { x: number; y: number; h: number }[];
  knock: { vx: number; vy: number; t: number } | null;
  blinking: boolean;
}

/** How much damage the player takes on each difficulty. */
export const DIFFICULTY_DAMAGE: Record<string, number> = { easy: 0.5, normal: 1, hard: 1.5 };

export function teamOf(e: Entity): Exclude<Team, 'auto'> {
  const s = e.get<Health>('health');
  if (s && s.team && s.team !== 'auto') return s.team;
  return e.tags.has('player') ? 'player' : 'enemy';
}

export function isHurtBy(target: Entity, hurts: Hurts): boolean {
  const team = teamOf(target);
  return hurts === 'anything' ? true : hurts === 'player' ? team === 'player' : team === 'enemy';
}

function stateFor(e: Entity, s: Health): HealthState {
  return stateOf<HealthState>(e, 'health', () => {
    const t = e.get<TransformIso>(C.Transform);
    return { hp: s.max, iframes: 0, dead: false, spawn: t ? { x: t.x, y: t.y, h: t.h } : null, trail: [], knock: null, blinking: false };
  });
}

/** Current and maximum health of an object (undefined if it has no Health). */
export function healthOf(e: Entity): { hp: number; max: number; dead: boolean } | undefined {
  const s = e.get<Health>('health');
  if (!s) return undefined;
  const st = stateFor(e, settingsOf(e, health));
  return { hp: st.hp, max: s.max, dead: st.dead };
}

export interface DamageOptions {
  source?: Entity;
  /** Push away from the source at this speed (cells per second). */
  knockback?: number;
  /** Hurts even during the invulnerable moments after a hit (falls). */
  ignoreIframes?: boolean;
  /** Seconds the world holds still on impact (default: a short hold when the player is hurt, none otherwise). */
  hitStop?: number;
  /** Pixels of screen shake on impact (default: a knock when the player is hurt, none otherwise). */
  shake?: number;
}

/** Hurt an object. Returns true if it took the damage (false if it was invulnerable, dead or has no Health). */
export function damage(ctx: SimContext, target: Entity, amount: number, opts: DamageOptions = {}): boolean {
  if (!target.alive || !target.has('health') || amount <= 0) return false;
  const s = settingsOf(target, health);
  const st = stateFor(target, s);
  if (st.dead) return false;
  if (st.iframes > 0 && !opts.ignoreIframes) return false;
  // difficulty only changes what the player takes
  if (teamOf(target) === 'player') amount *= DIFFICULTY_DAMAGE[ctx.runtime.difficulty] ?? 1;
  st.hp = Math.max(0, st.hp - amount);
  st.iframes = Math.max(st.iframes, s.invulnerableSeconds);
  if (opts.source && opts.knockback) {
    const a = transform(opts.source);
    const t = transform(target);
    const dx = t.x - a.x;
    const dy = t.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    st.knock = { vx: (dx / len) * opts.knockback, vy: (dy / len) * opts.knockback, t: 0.16 };
  }
  ctx.events.emit('damaged', { entity: target.id, amount, hp: st.hp, source: opts.source?.id });
  hitFeel(ctx, target, opts);
  return true;
}

/** The cosmetic side of a hit: a freeze frame, a knock of the screen, sparks and a sound. None of it touches the game's state. */
function hitFeel(ctx: SimContext, target: Entity, opts: DamageOptions): void {
  const isPlayer = teamOf(target) === 'player';
  const stop = opts.hitStop ?? (isPlayer ? 0.07 : 0);
  const shake = opts.shake ?? (isPlayer ? 5 : 0);
  if (stop > 0) requestHitStop(ctx.runtime, Math.round(stop * 60));
  if (shake > 0) addImpact(ctx.runtime, shake);
  const t = target.get<TransformIso>(C.Transform);
  if (t) emitFx(ctx.runtime, { kind: 'burst', preset: isPlayer ? 'spark' : 'hit', x: t.x, y: t.y, h: t.h });
  emitFx(ctx.runtime, { kind: 'sound', name: isPlayer ? 'hurt' : 'hit' });
}

export function heal(ctx: SimContext, target: Entity, amount: number): void {
  if (!target.has('health')) return;
  const s = settingsOf(target, health);
  const st = stateFor(target, s);
  if (st.dead) return;
  st.hp = Math.min(s.max, st.hp + amount);
  ctx.events.emit('healed', { entity: target.id, amount, hp: st.hp });
}

/** Make an object unhittable for a while (dodging). */
export function grantInvulnerability(e: Entity, seconds: number): void {
  if (!e.has('health')) return;
  const st = stateFor(e, settingsOf(e, health));
  st.iframes = Math.max(st.iframes, seconds);
}

/** Hearts for small amounts, a number once there would be too many to read. */
const hearts = (hp: number, max: number): string => max > 10 ? `${Math.max(0, Math.ceil(hp))}/${Math.ceil(max)}` : '♥'.repeat(Math.max(0, Math.ceil(hp))) + '♡'.repeat(Math.max(0, Math.ceil(max) - Math.ceil(hp)));

export const health = defineBehavior<Health>({
  id: 'health',
  name: 'Health',
  category: 'Combat',
  description: 'Hit points. Hurt by Damage on Touch and weapons, briefly invulnerable after a hit, takes damage from falling into pits, and dies, respawns or stays down at zero.',
  phase: 'control',
  defaults: { max: 3, invulnerableSeconds: 0.7, onDeath: 'remove', fallDamage: 1, team: 'auto', showBar: true },
  fields: [
    { key: 'max', label: 'Hit points', type: 'number', min: 1, max: 999, step: 1 },
    { key: 'invulnerableSeconds', label: 'Invulnerable after a hit (seconds)', type: 'number', min: 0, max: 5, step: 0.1 },
    {
      key: 'onDeath',
      label: 'At zero',
      type: 'select',
      options: [
        { value: 'remove', label: 'Disappears' },
        { value: 'respawn', label: 'Comes back at its start with full health' },
        { value: 'stay', label: 'Stays down (and sends its Dead signal)' },
      ],
    },
    { key: 'fallDamage', label: 'Damage from falling into a pit', type: 'number', min: 0, max: 99, step: 1 },
    {
      key: 'team',
      label: 'Side',
      type: 'select',
      options: [
        { value: 'auto', label: 'Automatic (the player is on the player side, everything else is an enemy)' },
        { value: 'player', label: 'Player side' },
        { value: 'enemy', label: 'Enemy side' },
        { value: 'neutral', label: 'Neutral (only "anything" hurts it)' },
      ],
    },
    { key: 'showBar', label: 'Show hearts above it (not for the player)', type: 'boolean' },
  ],
  inputs: [
    { name: 'heal', label: 'Heal fully', help: 'A rising signal restores all hit points.' },
    { name: 'kill', label: 'Kill', help: 'A rising signal takes all its hit points.' },
  ],
  outputs: [
    { name: 'dead', label: 'Is down' },
    { name: 'hurt', label: 'Was just hit' },
  ],
  requires: {},
  summary: (s) => `${s.max} hit points; ${s.onDeath === 'remove' ? 'disappears' : s.onDeath === 'respawn' ? 'respawns' : 'stays down'} at zero.`,
  update(ctx, e, s) {
    const st = stateFor(e, s);
    const t = transform(e);
    const b = body(e);
    const sp = sprite(e);
    const ctl = stateOf(e, 'healthSignals', () => ({ heal: false, kill: false }));
    const wantHeal = input(e, 'heal');
    const wantKill = input(e, 'kill');
    if (wantHeal && !ctl.heal && !st.dead) st.hp = s.max;
    if (wantKill && !ctl.kill) damage(ctx, e, st.hp, { ignoreIframes: true });
    ctl.heal = wantHeal;
    ctl.kill = wantKill;

    if (st.iframes > 0) st.iframes = Math.max(0, st.iframes - ctx.dt);

    // falling into a pit: take damage, then climb back to the last safe place
    if (b && b.state === 'pit' && !st.dead) {
      damage(ctx, e, s.fallDamage, { ignoreIframes: true });
      if (!st.dead) {
        const safe = st.trail[0] ?? st.spawn ?? { x: t.x, y: t.y, h: 0 };
        teleportBody(ctx, e, safe.x, safe.y, safe.h);
        st.iframes = Math.max(st.iframes, s.invulnerableSeconds);
        st.trail = [];
        ctx.events.emit('pit-recovered', { entity: e.id });
      }
    } else if (b && b.state === 'ground' && !b.blockedTerrain && !st.dead) {
      st.trail.push({ x: t.x, y: t.y, h: t.h });
      if (st.trail.length > 45) st.trail.shift();
    }

    // knockback overrides walking for a moment
    if (st.knock && b) {
      b.vx = st.knock.vx;
      b.vy = st.knock.vy;
      st.knock.t -= ctx.dt;
      if (st.knock.t <= 0) st.knock = null;
    }

    if (st.hp <= 0 && !st.dead) {
      st.dead = true;
      ctx.events.emit('died', { entity: e.id, tags: [...e.tags] });
      emitFx(ctx.runtime, { kind: 'burst', preset: 'puff', x: t.x, y: t.y, h: t.h });
      emitFx(ctx.runtime, { kind: 'sound', name: 'defeat' });
      if (s.onDeath === 'remove') {
        setOutput(e, 'dead', true);
        ctx.world.destroy(e);
        return;
      }
      if (s.onDeath === 'respawn') {
        let at = st.spawn ?? { x: t.x, y: t.y, h: t.h };
        const cp = e.tags.has('player') ? ctx.runtime.checkpoint : null;
        if (cp) {
          if (cp.scene === ctx.runtime.scene || cp.scene === '') at = { x: cp.x, y: cp.y, h: cp.h };
          else ctx.runtime.travel = { scene: cp.scene, spawn: '', x: cp.x, y: cp.y }; // the game host takes us there
        }
        if (b) teleportBody(ctx, e, at.x, at.y, at.h);
        else {
          t.x = at.x;
          t.y = at.y;
          t.h = at.h;
        }
        st.hp = s.max;
        st.dead = false;
        st.iframes = Math.max(1.5, s.invulnerableSeconds);
        st.knock = null;
        st.trail = [];
        ctx.events.emit('respawned', { entity: e.id });
      }
    }
    if (st.dead && b) {
      b.vx = 0;
      b.vy = 0;
    }
    setOutput(e, 'dead', st.dead);
    setOutput(e, 'hurt', st.iframes > 0 && st.hp < s.max);

    // feedback: blink while invulnerable, dim when down, hearts above enemies
    if (sp) {
      const blink = st.iframes > 0 && !st.dead && Math.floor(ctx.tick / 4) % 2 === 0;
      if (st.dead) sp.alpha = 0.35;
      else if (blink) {
        sp.alpha = 0.4;
        st.blinking = true;
      } else if (st.blinking) {
        sp.alpha = 1;
        st.blinking = false;
      } else if (sp.alpha === 0.35) sp.alpha = 1;
    }
    if (s.showBar && !e.tags.has('player') && !st.dead) {
      const text = hearts(st.hp, s.max);
      const cur = e.get<{ text: string }>('label');
      if (!cur || cur.text !== text) e.set('label', { text, color: 0xff6b6b, size: 12, bold: false, italic: false, underline: false, lift: 0.3 });
    } else if (st.dead && e.get<{ color: number }>('label')?.color === 0xff6b6b) e.remove('label');
  },
});

// ---------- damage on touch ----------

export interface DamageOnTouch {
  amount: number;
  hurts: Hurts;
  /** Extra reach around the object (cells). */
  range: number;
  knockback: number;
}

export const damageOnTouch = defineBehavior<DamageOnTouch>({
  id: 'damageOnTouch',
  timing: 'realtime',
  name: 'Damage on Touch',
  category: 'Combat',
  description: 'Hurts anything that is close enough and has Health: enemies that bump into you, spikes, lava, projectiles.',
  phase: 'actuator',
  defaults: { amount: 1, hurts: 'player', range: 0.6, knockback: 6 },
  fields: [
    { key: 'amount', label: 'Damage', type: 'number', min: 0, max: 99, step: 1 },
    {
      key: 'hurts',
      label: 'Hurts',
      type: 'select',
      options: [
        { value: 'player', label: 'The player' },
        { value: 'enemies', label: 'Enemies' },
        { value: 'anything', label: 'Anything with Health' },
      ],
    },
    { key: 'range', label: 'Reach beyond its edge (cells)', type: 'number', min: 0, max: 5, step: 0.1 },
    { key: 'knockback', label: 'Knockback (cells per second)', type: 'number', min: 0, max: 20, step: 0.5 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `Deals ${s.amount} damage to ${s.hurts === 'player' ? 'the player' : s.hurts === 'enemies' ? 'enemies' : 'anything'} that touches it.`,
  update(ctx, e, s) {
    const flags = aiFlags(e);
    if (flags.disabled) return;
    const own = e.get<{ dead: boolean }>('state:health');
    if (own?.dead) return;
    const t = transform(e);
    const sp = sprite(e);
    const reach = Math.max(sp ? Math.max(sp.w, sp.d) / 2 : 0.3, 0.3) + s.range;
    for (const o of ctx.world.query('health', C.Transform)) {
      if (o === e || !isHurtBy(o, s.hurts)) continue;
      const ot = transform(o);
      const ob = body(o);
      if (Math.abs(ot.h - t.h) > 1.2) continue;
      if (Math.hypot(ot.x - t.x, ot.y - t.y) <= reach + (ob?.radius ?? 0.3)) {
        damage(ctx, o, s.amount * flags.damageScale, { source: e, knockback: s.knockback });
      }
    }
  },
});

// ---------- melee attack (the quill) ----------

export interface MeleeAttack {
  damage: number;
  range: number;
  /** Width of the swing in degrees. */
  arc: number;
  windup: number;
  active: number;
  cooldown: number;
  knockback: number;
  hurts: Hurts;
  /** Seconds the world holds still when the swing connects. */
  hitStop: number;
  /** Pixels the screen shakes when the swing connects. */
  shake: number;
}

interface MeleeState {
  phase: 'idle' | 'windup' | 'active' | 'recover';
  t: number;
  hit: number[];
}

export function swingHits(attacker: TransformIso, targetX: number, targetY: number, radius: number, range: number, arcDegrees: number): boolean {
  const dx = targetX - attacker.x;
  const dy = targetY - attacker.y;
  const dist = Math.hypot(dx, dy);
  if (dist > range + radius) return false;
  if (dist < 0.35) return true;
  const f = facingVector(attacker.facing);
  const cos = (dx * f.x + dy * f.y) / dist;
  return cos >= Math.cos((arcDegrees / 2) * (Math.PI / 180));
}

export const meleeAttack = defineBehavior<MeleeAttack>({
  id: 'meleeAttack',
  timing: 'realtime',
  name: 'Melee Attack (quill)',
  category: 'Combat',
  description: 'Press the Attack button (J) to swing in the direction you face, hurting enemies in front of you. A short wind-up and recovery keep it fair.',
  phase: 'control',
  defaults: { damage: 1, range: 1.4, arc: 120, windup: 0.08, active: 0.16, cooldown: 0.3, knockback: 7, hurts: 'enemies', hitStop: 0.05, shake: 2 },
  fields: [
    { key: 'damage', label: 'Damage', type: 'number', min: 0, max: 99, step: 1 },
    { key: 'range', label: 'Reach (cells)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'arc', label: 'Swing width (degrees)', type: 'number', min: 20, max: 360, step: 10 },
    { key: 'windup', label: 'Wind-up (seconds)', type: 'number', min: 0, max: 1, step: 0.01 },
    { key: 'active', label: 'Hurts for (seconds)', type: 'number', min: 0.02, max: 1, step: 0.01 },
    { key: 'cooldown', label: 'Recovery (seconds)', type: 'number', min: 0, max: 3, step: 0.05 },
    { key: 'knockback', label: 'Knockback (cells per second)', type: 'number', min: 0, max: 20, step: 0.5 },
    {
      key: 'hurts',
      label: 'Hurts',
      type: 'select',
      options: [
        { value: 'enemies', label: 'Enemies' },
        { value: 'anything', label: 'Anything with Health' },
        { value: 'player', label: 'The player' },
      ],
    },
    { key: 'hitStop', label: 'Freeze on a hit (seconds)', type: 'number', min: 0, max: 0.2, step: 0.01 },
    { key: 'shake', label: 'Screen shake on a hit (pixels)', type: 'number', min: 0, max: 14, step: 0.5 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `Swings for ${s.damage} damage out to ${s.range} cells in a ${s.arc} degree arc.`,
  update(ctx, e, s) {
    const st = stateOf<MeleeState>(e, 'meleeAttack', () => ({ phase: 'idle', t: 0, hit: [] }));
    const own = e.get<{ dead: boolean }>('state:health');
    if (own?.dead || aiFlags(e).disabled) return;
    const anim = e.get<{ params: Record<string, unknown> }>('animator');
    const t = transform(e);
    if (st.phase === 'idle') {
      if (ctx.input.pressed('attack')) {
        st.phase = s.windup > 0 ? 'windup' : 'active';
        st.t = s.windup > 0 ? s.windup : s.active;
        st.hit = [];
        if (st.phase === 'active') beginSwing(ctx, e, s);
        ctx.events.emit('attack', { entity: e.id });
      }
    } else {
      st.t -= ctx.dt;
      if (st.phase === 'windup' && st.t <= 0) {
        st.phase = 'active';
        st.t = s.active;
        beginSwing(ctx, e, s);
      } else if (st.phase === 'active') {
        for (const o of ctx.world.query('health', C.Transform)) {
          if (o === e || st.hit.includes(o.id) || !isHurtBy(o, s.hurts)) continue;
          const ot = transform(o);
          if (Math.abs(ot.h - t.h) > 1.2) continue;
          if (swingHits(t, ot.x, ot.y, body(o)?.radius ?? 0.3, s.range, s.arc)) {
            st.hit.push(o.id);
            if (damage(ctx, o, s.damage * aiFlags(e).damageScale, { source: e, knockback: s.knockback, hitStop: s.hitStop, shake: s.shake })) ctx.events.emit('hit', { entity: e.id, target: o.id });
          }
        }
        if (st.t <= 0) {
          st.phase = 'recover';
          st.t = s.cooldown;
        }
      } else if (st.phase === 'recover' && st.t <= 0) st.phase = 'idle';
    }
    if (anim) anim.params.attacking = st.phase === 'windup' || st.phase === 'active';
  },
});

function beginSwing(ctx: SimContext, e: Entity, s: MeleeAttack): void {
  const t = transform(e);
  const f = facingVector(t.facing);
  ctx.world.spawn({
    name: 'Quill swing',
    tags: ['effect'],
    components: {
      transform: { x: t.x + f.x * s.range * 0.55, y: t.y + f.y * s.range * 0.55, h: t.h + 0.3, facing: t.facing },
      sprite: { shape: 'diamond', color: 0xfff2c0, w: s.range * 0.9, d: s.range * 0.9, height: 0.05, sortOffset: 1, visible: true, alpha: 0.7 },
      lifetime: { seconds: s.active + 0.04 },
    },
  });
}

// ---------- dodge ----------

export interface Dodge {
  speed: number;
  seconds: number;
  cooldown: number;
  invulnerable: boolean;
}

export const dodge = defineBehavior<Dodge>({
  id: 'dodge',
  timing: 'realtime',
  name: 'Dodge',
  category: 'Combat',
  description: 'Press the Dodge button for a quick burst of movement in the direction you are moving (or facing). You cannot be hurt while dodging.',
  phase: 'control',
  defaults: { speed: 9, seconds: 0.22, cooldown: 0.7, invulnerable: true },
  fields: [
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 2, max: 30, step: 0.5 },
    { key: 'seconds', label: 'How long (seconds)', type: 'number', min: 0.05, max: 1, step: 0.01 },
    { key: 'cooldown', label: 'Wait before the next one (seconds)', type: 'number', min: 0, max: 5, step: 0.05 },
    { key: 'invulnerable', label: 'Cannot be hurt while dodging', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `Dashes at ${s.speed} cells per second for ${s.seconds} s${s.invulnerable ? ', untouchable' : ''}.`,
  update(ctx, e, s) {
    const st = stateOf(e, 'dodge', () => ({ left: 0, wait: 0, dx: 0, dy: 0 }));
    const b = body(e);
    if (!b) return;
    if (st.wait > 0) st.wait -= ctx.dt;
    const own = e.get<{ dead: boolean }>('state:health');
    if (own?.dead) return;
    if (st.left <= 0 && st.wait <= 0 && ctx.input.pressed('dodge') && b.state === 'ground') {
      const v = ctx.input.vector('move_left', 'move_right', 'move_up', 'move_down');
      let g = screenIntentToGrid(v.x, v.y, ctx.runtime.view.rotation);
      if (g.x === 0 && g.y === 0) g = facingVector(transform(e).facing);
      st.dx = g.x;
      st.dy = g.y;
      st.left = s.seconds;
      st.wait = s.seconds + s.cooldown;
      ctx.events.emit('dodge', { entity: e.id });
    }
    if (st.left > 0) {
      st.left -= ctx.dt;
      b.vx = st.dx * s.speed;
      b.vy = st.dy * s.speed;
      if (s.invulnerable) grantInvulnerability(e, ctx.dt * 2);
    }
  },
});

// ---------- lifetime (for effects the engine spawns) ----------

export const lifetime = defineBehavior<{ seconds: number }>({
  id: 'lifetime',
  name: 'Lifetime',
  category: 'World',
  hidden: true,
  description: 'Disappears after a number of seconds.',
  phase: 'actuator',
  defaults: { seconds: 1 },
  fields: [{ key: 'seconds', label: 'Seconds', type: 'number', min: 0, max: 600, step: 0.1 }],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const st = stateOf(e, 'lifetime', () => ({ left: s.seconds }));
    st.left -= ctx.dt;
    if (st.left <= 0) ctx.world.destroy(e);
  },
});
