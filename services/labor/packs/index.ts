import type { RulePack } from '../types';
import { AMERICAS } from './americas';
import { EUROPE } from './europe';

/** Every rule pack by jurisdiction code (see ../jurisdictions.ts). */
export const PACKS: Record<string, RulePack> = { ...AMERICAS, ...EUROPE };
