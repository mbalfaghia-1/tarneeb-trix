// Rankings persistence: one row per (human player, finished online game). SQLite via
// Node's built-in driver — no native dependency, no extra service, just a file on the
// Fly volume (see fly.toml [mounts]). A single long-running machine (min_machines_running
// = 1) owns the file, so there's no multi-writer concern.
//
// `node:sqlite` is fetched via process.getBuiltinModule rather than a static import:
// this repo's Vite/Vitest version (5.4.21, from before this API existed) hardcodes an
// outdated Node builtin-module list and mis-resolves a literal `import ... from
// 'node:sqlite'` as a regular package — getBuiltinModule is a plain runtime call
// invisible to any bundler's static import analysis, so it sidesteps that entirely.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { GameKind, Seat, SeatOccupant } from '@tarneeb/room';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface GameResult {
  readonly game: GameKind;
  readonly partnership: boolean;
  readonly occupants: readonly SeatOccupant[];
  readonly winnerSeats: readonly Seat[];
}

export interface RankingRow {
  readonly playerId: string;
  readonly name: string;
  readonly games: number;
  readonly wins: number;
}

export interface RankingsDb {
  /** Record one finished online game. Bot seats are skipped — only humans are ranked. */
  recordGame(result: GameResult): void;
  /** Top players by wins (ties broken by games played), optionally filtered to one game. */
  leaderboard(game: GameKind | null, limit?: number): RankingRow[];
  close(): void;
}

export function openRankingsDb(path: string): RankingsDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      player_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game TEXT NOT NULL,
      partnership INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      won INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_results_player ON results(player_id);
    CREATE INDEX IF NOT EXISTS idx_results_game ON results(game);
  `);

  const upsertPlayer = db.prepare(
    `INSERT INTO players (player_id, name, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
  );
  const insertResult = db.prepare(
    `INSERT INTO results (game, partnership, player_id, won, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const leaderboardAll = db.prepare(
    `SELECT p.player_id as playerId, p.name as name, COUNT(*) as games, SUM(r.won) as wins
     FROM results r JOIN players p ON p.player_id = r.player_id
     GROUP BY r.player_id
     ORDER BY wins DESC, games DESC
     LIMIT ?`,
  );
  const leaderboardByGame = db.prepare(
    `SELECT p.player_id as playerId, p.name as name, COUNT(*) as games, SUM(r.won) as wins
     FROM results r JOIN players p ON p.player_id = r.player_id
     WHERE r.game = ?
     GROUP BY r.player_id
     ORDER BY wins DESC, games DESC
     LIMIT ?`,
  );

  return {
    recordGame(result) {
      const now = Date.now();
      const partnershipFlag = result.partnership ? 1 : 0;
      for (let seat = 0; seat < result.occupants.length; seat++) {
        const o = result.occupants[seat]!;
        if (o.kind !== 'human') continue; // bots are never ranked
        const won = result.winnerSeats.includes(seat as Seat) ? 1 : 0;
        upsertPlayer.run(o.playerId, o.name, now);
        insertResult.run(result.game, partnershipFlag, o.playerId, won, now);
      }
    },
    leaderboard(game, limit = 50) {
      const rows = game ? leaderboardByGame.all(game, limit) : leaderboardAll.all(limit);
      return rows.map((r) => ({
        playerId: String(r.playerId),
        name: String(r.name),
        games: Number(r.games),
        wins: Number(r.wins),
      }));
    },
    close() {
      db.close();
    },
  };
}
