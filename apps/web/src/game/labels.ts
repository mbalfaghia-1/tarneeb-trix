import type { Seat } from '@tarneeb/engine';
import { posOf } from './layout';
import type { T } from '../i18n';

/** Localised label for a seat, positioned relative to the human at the bottom. */
export function turnName(seat: Seat, t: T): string {
  switch (posOf(seat, 0 as Seat)) {
    case 'bottom':
      return t('youBid');
    case 'top':
      return t('partner');
    case 'left':
      return t('leftOpp');
    case 'right':
      return t('rightOpp');
  }
}
