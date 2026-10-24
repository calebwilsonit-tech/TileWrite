import path from 'node:path';
import type { Scenario } from '../harness/trace';
import { demo } from './Demo';

/**
 * Button presses that exercise what one particular project is about (the generic key script every project gets
 * cannot know where its switches are). Keyed by the project's folder name. Add a scenario here when a project of the
 * owner's, or a bug, needs a path through the game that must keep working.
 */
const SCENARIOS: Record<string, Scenario[]> = {
  Demo: demo,
};

export function scenariosOf(dir: string): Scenario[] {
  return SCENARIOS[path.basename(dir)] ?? [];
}
