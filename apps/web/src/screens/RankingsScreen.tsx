import { useEffect, useState } from 'react';
import type { GameKind } from '@tarneeb/room';
import type { T } from '../i18n';

const SERVER_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ||
  'ws://localhost:8787';
/** The rankings endpoint is plain HTTP(S) on the same host/port as the game WebSocket. */
const HTTP_BASE = SERVER_URL.replace(/^ws/, 'http');

interface RankingRow {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  points: number;
}

const GAME_TABS: readonly (GameKind | null)[] = [null, 'tarneeb', 'trix', 'trixComplex'];

export function RankingsScreen({ t }: { t: T }) {
  const [game, setGame] = useState<GameKind | null>(null); // null = every game combined
  const [rows, setRows] = useState<RankingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const url = `${HTTP_BASE}/rankings${game ? `?game=${game}` : ''}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ players: RankingRow[] }>;
      })
      .then((data) => {
        if (!cancelled) setRows(data.players);
      })
      .catch(() => {
        if (!cancelled) setError(t('connErrBody'));
      });
    return () => {
      cancelled = true;
    };
  }, [game, t]);

  const tabLabel = (g: GameKind | null): string =>
    g === null ? t('all') : g === 'tarneeb' ? t('tarneeb') : g === 'trix' ? t('trixName') : t('trixComplex');

  return (
    <main className="online">
      <div className="online-card">
        <div className="seg">
          {GAME_TABS.map((g) => (
            <button key={g ?? 'all'} type="button" className={game === g ? 'on' : ''} onClick={() => setGame(g)}>
              {tabLabel(g)}
            </button>
          ))}
        </div>

        {error && <p className="online-error">{error}</p>}
        {!error && rows === null && <p className="online-hint">{t('connecting')}</p>}
        {!error && rows !== null && rows.length === 0 && <p className="online-hint">{t('noRankingsYet')}</p>}
        {!error && rows !== null && rows.length > 0 && (
          <div className="calc-history">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('yourName')}</th>
                  <th>{t('rankPoints')}</th>
                  <th>{t('rankWins')}</th>
                  <th>{t('rankGames')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerId}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td className="pos">{r.points}</td>
                    <td>{r.wins}</td>
                    <td>{r.games}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
