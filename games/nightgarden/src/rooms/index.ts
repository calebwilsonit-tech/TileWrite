import type { Chapter } from '../build';
import { CH1 } from './ch1';
import { CH2 } from './ch2';
import { CH3 } from './ch3';
import { CH4 } from './ch4';
import { CH5 } from './ch5';

/** Every chapter of the game, in play order. */
export const CHAPTERS: Chapter[] = [CH1, CH2, CH3, CH4, CH5];
