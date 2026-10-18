import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openRankingsDb } from './db.js';

describe('rankings db', () => {
  it('records only human seats, never bots', () => {
    const db = openRankingsDb(':memory:');
    db.recordGame({
      game: 'tarneeb',
      partnership: false,
      occupants: [
        { kind: 'human', playerId: 'p0', name: 'Alice' },
        { kind: 'bot', name: 'الصقر' },
        { kind: 'human', playerId: 'p2', name: 'Alice-partner' },
        { kind: 'bot', name: 'الذيب' },
      ],
      winnerSeats: [0, 2],
    });
    const board = db.leaderboard('tarneeb');
    expect(board.map((r) => r.playerId).sort()).toEqual(['p0', 'p2']);
    for (const row of board) {
      expect(row.games).toBe(1);
      expect(row.wins).toBe(1);
      expect(row.points).toBe(10); // Tarneeb win
    }
    db.close();
  });

  it('accumulates wins/games/points across multiple results and ranks by points', () => {
    const db = openRankingsDb(':memory:');
    const play = (playerId: string, won: boolean) =>
      db.recordGame({
        game: 'trix',
        partnership: false,
        occupants: [
          { kind: 'human', playerId, name: playerId },
          { kind: 'bot', name: 'الصقر' },
          { kind: 'bot', name: 'الذيب' },
          { kind: 'bot', name: 'الأسد' },
        ],
        winnerSeats: won ? [0] : [1],
      });

    play('winner', true);
    play('winner', true);
    play('winner', false);
    play('loser', false);

    const board = db.leaderboard('trix');
    expect(board[0]!.playerId).toBe('winner');
    expect(board[0]!.games).toBe(3);
    expect(board[0]!.wins).toBe(2);
    expect(board[0]!.points).toBe(30); // 2 Trix wins * 15
    expect(board[1]!.playerId).toBe('loser');
    expect(board[1]!.wins).toBe(0);
    expect(board[1]!.points).toBe(0); // losses never earn points
    db.close();
  });

  it('weights points by game difficulty, so fewer harder wins can outrank more easy wins', () => {
    const db = openRankingsDb(':memory:');
    const occupantsFor = (playerId: string) => [
      { kind: 'human' as const, playerId, name: playerId },
      { kind: 'bot' as const, name: 'x' },
      { kind: 'bot' as const, name: 'y' },
      { kind: 'bot' as const, name: 'z' },
    ];
    // "grinder" wins 3 easy Tarneeb games (3 * 10 = 30 points).
    for (let i = 0; i < 3; i++) {
      db.recordGame({ game: 'tarneeb', partnership: false, occupants: occupantsFor('grinder'), winnerSeats: [0] });
    }
    // "specialist" wins just 2 Trix Complex games (2 * 20 = 40 points) — fewer wins, more points.
    for (let i = 0; i < 2; i++) {
      db.recordGame({
        game: 'trixComplex',
        partnership: false,
        occupants: occupantsFor('specialist'),
        winnerSeats: [0],
      });
    }

    const overall = db.leaderboard(null);
    expect(overall[0]!.playerId).toBe('specialist'); // 40 points > 30, despite 2 wins < 3
    expect(overall[0]!.points).toBe(40);
    expect(overall[1]!.playerId).toBe('grinder');
    expect(overall[1]!.points).toBe(30);
    db.close();
  });

  it('filters by game and keeps the most recently seen display name', () => {
    const db = openRankingsDb(':memory:');
    const occupants = (name: string): readonly { kind: 'human'; playerId: string; name: string }[] => [
      { kind: 'human', playerId: 'p0', name },
    ];
    db.recordGame({ game: 'tarneeb', partnership: false, occupants: occupants('OldName'), winnerSeats: [0] });
    db.recordGame({ game: 'trix', partnership: false, occupants: occupants('NewName'), winnerSeats: [] });

    expect(db.leaderboard('tarneeb')).toHaveLength(1);
    expect(db.leaderboard('trixComplex')).toHaveLength(0);
    const all = db.leaderboard(null);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('NewName'); // upserted to the latest name seen
    expect(all[0]!.games).toBe(2);
    db.close();
  });

  it('migrates a pre-points DB: adds the column and backfills historical wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tarneeb-rankings-'));
    const dbPath = join(dir, 'rankings.db');
    try {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
        DatabaseSync: new (path: string) => {
          exec(sql: string): void;
          close(): void;
        };
      };
      // Simulate a DB created before the `points` column existed.
      const old = new DatabaseSync(dbPath);
      old.exec(`
        CREATE TABLE players (player_id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE results (
          id INTEGER PRIMARY KEY AUTOINCREMENT, game TEXT NOT NULL, partnership INTEGER NOT NULL,
          player_id TEXT NOT NULL, won INTEGER NOT NULL, created_at INTEGER NOT NULL
        );
        INSERT INTO players (player_id, name, updated_at) VALUES ('p0', 'Legacy', 1);
        INSERT INTO results (game, partnership, player_id, won, created_at) VALUES ('trixComplex', 0, 'p0', 1, 1);
        INSERT INTO results (game, partnership, player_id, won, created_at) VALUES ('tarneeb', 0, 'p0', 0, 2);
      `);
      old.close();

      const db = openRankingsDb(dbPath);
      const board = db.leaderboard(null);
      expect(board).toHaveLength(1);
      expect(board[0]!.games).toBe(2);
      expect(board[0]!.wins).toBe(1);
      expect(board[0]!.points).toBe(20); // backfilled: the won Trix Complex row -> 20, the loss -> 0
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
