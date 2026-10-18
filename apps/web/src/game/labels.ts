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

/** The server sends a bot's name as a stable, language-neutral key (see BOT_NAME_KEYS in
 *  packages/room/src/room.ts) — it has no notion of the viewer's language. Translate it
 *  here, same as every other label; an unrecognised key (e.g. the rare 'Bot N' overflow
 *  fallback) is passed through unchanged rather than breaking. */
const BOT_NAME_I18N_KEY: Record<string, string> = {
  falcon: 'botFalcon',
  wolf: 'botWolf',
  lion: 'botLion',
  tiger: 'botTiger',
};

export function botDisplayName(rawName: string, t: T): string {
  const key = BOT_NAME_I18N_KEY[rawName];
  return key ? t(key as Parameters<T>[0]) : rawName;
}
