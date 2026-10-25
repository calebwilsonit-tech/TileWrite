import { TileDefSchema, type IsoConfig } from '@tilewright/runtime';
import { z } from 'zod';
import { dialoguePicture, graphPicture } from './graph';
import { renderScene, type PreviewProject } from './scene';
import { renderScreens } from './screen';
import { renderTileset } from './tileset';

export type { PreviewProject } from './scene';

/**
 * Pictures of the project's own files for the assistant: a scene's map and logic graphs, the screens of a screens file, a
 * conversation as boxes and arrows, the tiles of a project. Each is drawn from the file's data alone, so what comes back is the
 * file's text AND a picture of it. Anything else has no picture (null).
 */

export interface FilePreview {
  png: Uint8Array;
  /** What the picture is, for the text beside it. */
  caption: string;
}

export interface FilePreviews {
  pictures: FilePreview[];
  notes: string[];
}

/** The most pictures one file gives back (a scene with many graphs, a file with many screens). */
export const MOST_PICTURES = 4;

export function previewsFor(path: string, json: unknown, project: PreviewProject): FilePreviews | null {
  const pictures: FilePreview[] = [];
  const notes: string[] = [];
  if (path.endsWith('.scene.json')) {
    const scene = renderScene(json, project);
    if (!scene) return null;
    pictures.push({ png: scene.png, caption: 'The map and its objects' });
    notes.push(...scene.notes);
    const graphs = Array.isArray((json as { graphs?: unknown }).graphs) ? ((json as { graphs: unknown[] }).graphs) : [];
    for (const g of graphs.slice(0, MOST_PICTURES - 1)) {
      const pic = graphPicture(g);
      if (pic) {
        pictures.push({ png: pic.png, caption: `Logic graph "${pic.title}"` });
        notes.push(...pic.notes);
      }
    }
    if (graphs.length > MOST_PICTURES - 1) notes.push(`${graphs.length} logic graphs in this scene; the first ${MOST_PICTURES - 1} are drawn.`);
    return { pictures, notes };
  }
  if (/(^|\/)screens\.json$/.test(path)) {
    const screens = renderScreens(json, MOST_PICTURES);
    if (!screens) return null;
    for (const s of screens.pictures) {
      pictures.push({ png: s.png, caption: `Screen "${s.name}"` });
      notes.push(...s.notes);
    }
    notes.push(...screens.notes);
    return { pictures, notes };
  }
  if (path.endsWith('.dialogue.json')) {
    const pic = dialoguePicture(json);
    if (!pic) return null;
    return { pictures: [{ png: pic.png, caption: `Conversation "${pic.title}"` }], notes: pic.notes };
  }
  if (/(^|\/)project\.json$/.test(path)) {
    const tiles = z.array(TileDefSchema).safeParse((json as { tileset?: unknown }).tileset);
    if (!tiles.success) return null;
    const pic = renderTileset(tiles.data);
    return pic ? { pictures: [{ png: pic.png, caption: 'The tiles' }], notes: pic.notes } : null;
  }
  return null;
}

/** The look of the world from the project file (the tile set and the isometric sizes), for drawing scenes. */
export function previewProject(project: { tileset: readonly z.infer<typeof TileDefSchema>[]; iso: IsoConfig }): PreviewProject {
  return { tileset: project.tileset, iso: project.iso };
}
