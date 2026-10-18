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
    }
    db.close();
  });

  it('accumulates wins/games across multiple results and ranks by wins', () => {
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
    expect(board[1]!.playerId).toBe('loser');
    expect(board[1]!.wins).toBe(0);
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
});
