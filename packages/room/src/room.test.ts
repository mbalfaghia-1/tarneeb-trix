import { describe, expect, it } from 'vitest';
import {
  getLegalActions,
  getTrixLegalActions,
  type Seat,
  type TarneebState,
  type TrixState,
} from '@tarneeb/engine';
import { createRoom } from './room.js';
import type { RoomHandle } from './types.js';

/** Drive a room to completion, letting each named human play its first legal move
 *  whenever it is that seat's turn. Returns the finished raw state. */
function playOut(room: RoomHandle, humansBySeat: Record<number, string>, trix = false): unknown {
  for (let guard = 0; guard < 100_000; guard++) {
    if (room.isTerminal()) break;
    const seat = room.awaitingSeat();
    if (seat === null) throw new Error('not terminal but no seat to act');
    const playerId = humansBySeat[seat];
    if (!playerId) throw new Error(`awaiting a non-human seat ${seat}`);
    const view = room.viewFor(seat);
    const legal = trix
      ? getTrixLegalActions(view.state as TrixState)
      : getLegalActions(view.state as TarneebState);
    room.submit(playerId, legal[0]);
  }
  if (!room.isTerminal()) throw new Error('did not terminate');
  return room.rawState();
}

describe('room: all-bot tables auto-play to a result', () => {
  it('Tarneeb: a table of four bots finishes with a winner', () => {
    const room = createRoom({ game: 'tarneeb', seed: 7 });
    expect(room.isTerminal()).toBe(true); // no humans → advance() runs the whole game
    expect((room.rawState() as TarneebState).winner).not.toBeNull();
  });

  it('Trix: a table of four bots finishes with a winner', () => {
    const room = createRoom({ game: 'trix', seed: 7 });
    expect(room.isTerminal()).toBe(true);
    expect((room.rawState() as TrixState).winner).not.toBeNull();
  });
});

describe('room: humans + bots played through the room API', () => {
  it('Tarneeb: one human (seat 0) + three bots reaches a winner', () => {
    const room = createRoom({ game: 'tarneeb', seed: 11 }, [{ playerId: 'p0', name: 'Me' }]);
    const end = playOut(room, { 0: 'p0' }) as TarneebState;
    expect(end.winner).not.toBeNull();
  });

  it('Tarneeb: two humans (seats 0 & 1) + two bots reaches a winner', () => {
    const room = createRoom({ game: 'tarneeb', seed: 3 }, [
      { playerId: 'p0', name: 'A' },
      { playerId: 'p1', name: 'B' },
    ]);
    const end = playOut(room, { 0: 'p0', 1: 'p1' }) as TarneebState;
    expect(end.winner).not.toBeNull();
  });

  it('Trix: one human (seat 0) + three bots reaches a winner', () => {
    const room = createRoom({ game: 'trix', seed: 5 }, [{ playerId: 'p0', name: 'Me' }]);
    const end = playOut(room, { 0: 'p0' }, true) as TrixState;
    expect(end.winner).not.toBeNull();
  });
});

describe('room: turn timeout (auto-play a stalled human)', () => {
  it('forceCurrentTurn plays the waiting human turn and advances', () => {
    const room = createRoom({ game: 'tarneeb', seed: 11 }, [{ playerId: 'p0', name: 'Me' }]);
    expect(room.awaitingSeat()).toBe(0); // human on turn
    const before = JSON.stringify(room.rawState());
    expect(room.forceCurrentTurn()).toBe(true);
    expect(JSON.stringify(room.rawState())).not.toBe(before); // the turn was played
  });

  it('forceCurrentTurn is a no-op on a finished (all-bot) table', () => {
    const room = createRoom({ game: 'tarneeb', seed: 11 }); // no humans → runs to the end
    expect(room.isTerminal()).toBe(true);
    expect(room.forceCurrentTurn()).toBe(false);
  });

  it('repeated forceCurrentTurn drives a 1-human game to completion', () => {
    const room = createRoom({ game: 'tarneeb', seed: 4 }, [{ playerId: 'p0', name: 'AFK' }]);
    let guard = 0;
    while (!room.isTerminal() && guard++ < 100_000) room.forceCurrentTurn();
    expect(room.isTerminal()).toBe(true);
  });
});

describe('room: vacate a seat (a human leaves mid-game)', () => {
  it('turns the seat into a bot, keeps its name, and stops awaiting it', () => {
    const room = createRoom({ game: 'tarneeb', seed: 11 }, [{ playerId: 'p0', name: 'Me' }]);
    expect(room.awaitingSeat()).toBe(0); // the human is on turn
    expect(room.seatOf('p0')).toBe(0);

    expect(room.vacateSeat(0)).toBe(true);
    expect(room.occupants[0]!.kind).toBe('bot');
    expect(room.occupants[0]!.name).toBe('Bot 1'); // relabeled so it's clearly a bot now
    expect(room.seatOf('p0')).toBeNull(); // no longer a seated human
    expect(room.isTerminal()).toBe(true); // now all bots → advance() ran it to the end

    expect(room.vacateSeat(0)).toBe(false); // already a bot
  });

  it('lets the remaining humans keep playing after one leaves', () => {
    const room = createRoom({ game: 'tarneeb', seed: 3 }, [
      { playerId: 'p0', name: 'A' },
      { playerId: 'p1', name: 'B' },
    ]);
    room.vacateSeat(0); // A leaves; seat 0 is now a bot
    expect(room.occupants[0]!.kind).toBe('bot');
    const end = playOut(room, { 1: 'p1' }) as TarneebState; // B alone can finish it
    expect(end.winner).not.toBeNull();
  });
});

describe('room: Trix doubling (a freeform action) accepted from a human', () => {
  it('applies SET_DOUBLE with a chosen card, not just the decline variant', () => {
    // Find a complex deal where seat 0 (the only human) faces a doubling decision
    // holding a doubleable card, then submit a real double through the room API.
    for (let seed = 1; seed < 400; seed++) {
      const room = createRoom({ game: 'trixComplex', seed }, [{ playerId: 'p0', name: 'Me' }]);
      let guard = 0;
      while (!room.isTerminal() && guard++ < 50) {
        if (room.awaitingSeat() !== 0) break;
        const st = room.rawState() as TrixState;
        if (st.phase === 'contract-select') {
          room.submit('p0', { type: 'CHOOSE_CONTRACT', seat: 0, contract: 'complex' });
          continue;
        }
        if (st.phase === 'doubling') {
          const dbl = st.hands[0]!.filter((c) => c.rank === 12 || (c.suit === 'H' && c.rank === 13));
          if (dbl.length === 0) {
            room.submit('p0', { type: 'SET_DOUBLE', seat: 0, cards: [] });
            continue;
          }
          const before = st.doubled.length;
          room.submit('p0', { type: 'SET_DOUBLE', seat: 0, cards: [dbl[0]!] });
          expect((room.rawState() as TrixState).doubled.length).toBe(before + 1);
          return; // proved a real double was accepted
        }
        break; // playing/shedding — this deal gave seat 0 no doubling decision
      }
    }
    throw new Error('no seed produced a seat-0 doubling decision to test');
  });
});

describe('room: per-seat redaction never leaks other hands', () => {
  it('a seat view shows only its own cards; others are hidden but counted', () => {
    const room = createRoom({ game: 'tarneeb', seed: 42 }, [
      { playerId: 'p0', name: 'A' },
      { playerId: 'p1', name: 'B' },
    ]);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view = room.viewFor(seat);
      const st = view.state as TarneebState;
      for (const other of [0, 1, 2, 3] as Seat[]) {
        if (other === seat) {
          expect(st.hands[other]!.length).toBe(view.handCounts[other]);
        } else {
          expect(st.hands[other]!.length).toBe(0); // redacted away
        }
        expect(view.handCounts[other]).toBeGreaterThan(0); // sizes still known
      }
    }
  });
});

describe('room: action validation', () => {
  it('rejects an unseated player, an illegal action, and acting for another seat', () => {
    const room = createRoom({ game: 'tarneeb', seed: 9 }, [
      { playerId: 'p0', name: 'A' },
      { playerId: 'p1', name: 'B' },
    ]);
    const seat = room.awaitingSeat()!;
    const me = seat === 0 ? 'p0' : 'p1';
    const other = seat === 0 ? 'p1' : 'p0';
    const legal = getLegalActions(room.viewFor(seat).state as TarneebState);

    expect(() => room.submit('ghost', legal[0])).toThrow(); // not seated
    expect(() => room.submit(me, { type: 'PASS', seat: 9 })).toThrow(); // not a legal action
    // The other human tries to play the current seat's legal move → wrong seat.
    expect(() => room.submit(other, legal[0])).toThrow();

    // The correct player’s legal move is accepted and advances the game.
    const before = JSON.stringify(room.rawState());
    room.submit(me, legal[0]);
    expect(JSON.stringify(room.rawState())).not.toBe(before);
  });
});
