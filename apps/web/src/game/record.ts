// A lightweight, per-device play record kept in localStorage — games played and won
// for each game type. No backend; purely a personal tally shown on the menu. (A real
// cross-device history / leaderboard waits for accounts.)
export type RecordGameId = 'tarneeb' | 'trix' | 'trixComplex';

export interface GameRec {
  played: number;
  won: number;
}
export type PlayRecord = Record<RecordGameId, GameRec>;

const KEY = 'tarneeb.record.v1';
const empty = (): PlayRecord => ({
  tarneeb: { played: 0, won: 0 },
  trix: { played: 0, won: 0 },
  trixComplex: { played: 0, won: 0 },
});

export function loadRecord(): PlayRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<PlayRecord>;
    const base = empty();
    for (const g of ['tarneeb', 'trix', 'trixComplex'] as const) {
      const r = parsed[g];
      if (r && typeof r.played === 'number' && typeof r.won === 'number') base[g] = r;
    }
    return base;
  } catch {
    return empty();
  }
}

/** Record one finished game. `won` = did the viewer's seat/team win. */
export function addResult(game: RecordGameId, won: boolean): void {
  try {
    const rec = loadRecord();
    rec[game] = { played: rec[game].played + 1, won: rec[game].won + (won ? 1 : 0) };
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* ignore storage failures */
  }
}
