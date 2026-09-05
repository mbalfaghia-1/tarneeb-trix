import { describe, expect, it } from 'vitest';
import { getLegalActions, type TarneebState } from '@tarneeb/engine';
import { Lobby } from './lobby.js';

describe('lobby: seating and start', () => {
  it('creates a table, seats joiners, and reflects them in lobby state', () => {
    const lobby = new Lobby();
    const code = lobby.createTable({ playerId: 'p0', name: 'Host' }, 'tarneeb');
    expect(lobby.seatOf(code, 'p0')).toBe(0);

    expect(lobby.join(code, { playerId: 'p1', name: 'Two' })).toBe(1);
    expect(lobby.join(code, { playerId: 'p1', name: 'Two' })).toBe(1); // idempotent

    const state = lobby.lobbyState(code);
    expect(state.started).toBe(false);
    expect(state.seats.map((s) => s.kind)).toEqual(['human', 'human', 'empty', 'empty']);
  });

  it('rejects joining a full or already-started table', () => {
    const lobby = new Lobby();
    const code = lobby.createTable({ playerId: 'p0', name: 'H' }, 'tarneeb');
    lobby.join(code, { playerId: 'p1', name: 'B' });
    lobby.join(code, { playerId: 'p2', name: 'C' });
    lobby.join(code, { playerId: 'p3', name: 'D' });
    expect(() => lobby.join(code, { playerId: 'p4', name: 'E' })).toThrow(); // full
    lobby.start(code, 'p0');
    expect(() => lobby.join(code, { playerId: 'p5', name: 'F' })).toThrow(); // started
  });

  it('only the host can start; empty seats become bots', () => {
    const lobby = new Lobby();
    const code = lobby.createTable({ playerId: 'p0', name: 'H' }, 'tarneeb');
    lobby.join(code, { playerId: 'p1', name: 'B' });
    expect(() => lobby.start(code, 'p1')).toThrow(); // not host
    lobby.start(code, 'p0');
    const state = lobby.lobbyState(code);
    expect(state.started).toBe(true);
    expect(state.seats.map((s) => s.kind)).toEqual(['human', 'human', 'bot', 'bot']);
  });

  it('drives a game through the lobby and redacts views per seat', () => {
    const lobby = new Lobby();
    const code = lobby.createTable({ playerId: 'p0', name: 'H' }, 'tarneeb');
    lobby.start(code, 'p0'); // 1 human + 3 bots

    // Only seat 0 is human, so it is always the awaiting seat when control returns.
    const view = lobby.viewFor(code, 'p0')!;
    expect(view.seat).toBe(0);
    expect(view.yourTurn).toBe(true);
    const st = view.state as TarneebState;
    expect(st.hands[1]!.length).toBe(0); // other hands redacted
    expect(view.handCounts[1]).toBeGreaterThan(0); // counts still visible

    // A legal move for seat 0 (derived from its own view) is accepted.
    const legal = getLegalActions(st);
    expect(() => lobby.submit(code, 'p0', legal[0])).not.toThrow();
  });

  it('promotes a new host when the host leaves before start', () => {
    const lobby = new Lobby();
    const code = lobby.createTable({ playerId: 'p0', name: 'H' }, 'tarneeb');
    lobby.join(code, { playerId: 'p1', name: 'B' });
    lobby.leave(code, 'p0');
    expect(lobby.lobbyState(code).hostId).toBe('p1');
  });
});
