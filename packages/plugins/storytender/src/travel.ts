import { screenKit, type ActionDef, type ListSourceDef, type MenuEntryDef, type UiScreen } from '@tilewright/plugin-sdk';
import { litPosts } from './checkpoint';

const { action, closeScreen, menuScreen, repeat, row, resetIds } = screenKit;

const short = (scene: string): string => (scene ? scene.replace(/^.*\//, '').replace('.scene.json', '') : 'this area');

/** The lit lantern posts, as rows for a list in a screen. */
export const litPostsSource: ListSourceDef = {
  id: 'lit-posts',
  label: 'Lantern posts the player has lit',
  rows: (sim) =>
    litPosts(sim.runtime.vars).map((p, i) => ({
      id: `${p.scene}:${p.id}`,
      scope: { 'post.id': p.id, 'post.name': p.name, 'post.scene': p.scene, 'post.place': sim.assets.strings.t(short(p.scene)), 'post.x': p.x, 'post.y': p.y, 'post.h': p.h, index: i + 1 },
    })),
};

export const travelToPost: ActionDef = {
  id: 'travelToPost',
  label: 'Travel to a lit lantern post',
  category: 'Story',
  params: [
    { key: 'scene', label: 'Scene file of the post', type: 'text', default: '' },
    { key: 'id', label: 'Post (object id)', type: 'text', default: '' },
    { key: 'name', label: 'Post name', type: 'text', default: '' },
    { key: 'x', label: 'x', type: 'text', default: '0' },
    { key: 'y', label: 'y', type: 'text', default: '0' },
    { key: 'h', label: 'height', type: 'text', default: '0' },
  ],
  describe: (p) => `travel to the lit post "${String(p.name ?? '') || String(p.id ?? '')}"`,
  run(ctx, p) {
    const fill = (k: string): string => {
      const text = String(p[k] ?? '');
      return text.includes('{') ? text.replace(/\{([^}]+)\}/g, (_m, name: string) => String(ctx.runtime.vars[name.trim()] ?? '')) : text;
    };
    ctx.events.emit('travel-post-request', { scene: fill('scene'), id: fill('id'), name: fill('name'), x: Number(fill('x')), y: Number(fill('y')), h: Number(fill('h')) });
  },
};

export const travelMenuEntry: MenuEntryDef = {
  id: 'travel',
  menu: 'pause',
  label: 'Travel to a lit lantern',
  opens: 'travel',
  order: 20,
  detail: (sim) => sim.assets.strings.fmt(sim.assets.strings.t('{n} lit'), { n: litPosts(sim.runtime.vars).length }),
};

/** The screen that lists the lit posts. A project can copy it and change it like any other screen. */
export function travelScreen(): UiScreen {
  resetIds();
  const post = row(
    'post',
    'Post',
    '{post.name}',
    '{post.place}',
    [action('travelToPost', { scene: '{post.scene}', id: '{post.id}', name: '{post.name}', x: '{post.x}', y: '{post.y}', h: '{post.h}' }), closeScreen('role:travel'), closeScreen('role:pause')],
  );
  return menuScreen({
    id: 'storytender-travel',
    name: 'Travel',
    role: 'travel',
    title: screenKit.heading('travel.title', 'Travel to a lit lantern'),
    rows: [repeat('posts', 'Posts', 'lit-posts', post, { empty: 'No lanterns lit yet. Light one by pressing E beside it.' })],
    hint: 'W / S to choose, E to select, Esc or P to go back',
  });
}

/** The words these show, for the translation tables. */
export const TRAVEL_WORDS = ['Travel', 'Travel to a lit lantern', '{n} lit', 'No lanterns lit yet. Light one by pressing E beside it.', 'this area', 'W / S to choose, E to select, Esc or P to go back'];
