import type { EntityData } from '@tilewright/runtime';
import type { PlaybotMoveDef, PlaybotScene, PlaybotStrategyDef } from '@tilewright/behaviors';
import type { Bot, Game, PlayReport } from '@tilewright/playbot';

/** Make a playbot strategy: a button in the Playbot panel that plays the open scene a certain way. The bot is the real one. */
export function definePlaybotStrategy(def: {
  id: string;
  label: string;
  help?: string;
  unavailable?(scene: PlaybotScene): string | null;
  play(bot: Bot, scene: PlaybotScene): PlayReport;
}): PlaybotStrategyDef {
  return { ...def, play: (bot, scene) => def.play(bot as Bot, scene) };
}

/** Make a step the puzzle solver can combine with others. The bot and the game are the real ones. */
export function definePlaybotMove(def: {
  id: string;
  offer(entity: EntityData, player: EntityData | undefined): { ref: string; label: string }[];
  perform(bot: Bot, game: Game, ref: string, memory: Record<string, unknown>): boolean;
}): PlaybotMoveDef {
  return { ...def, perform: (bot, game, ref, memory) => def.perform(bot as Bot, game as Game, ref, memory) };
}
