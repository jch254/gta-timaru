import type { MissionDef } from '../types';
import { fourAvenues } from './four-avenues';
import { mintSauce } from './mint-sauce';
import { onIce } from './on-ice';
import { puntReturn } from './punt-return';
import { severancePay } from './severance-pay';
import { southerlyChange } from './southerly-change';

/**
 * The story, in order: Timaru → up SH1 → Christchurch → over the hill to Lyttelton.
 * Each mission unlocks the next.
 */
export const MISSIONS: readonly MissionDef[] = [severancePay, onIce, mintSauce, fourAvenues, puntReturn, southerlyChange];
