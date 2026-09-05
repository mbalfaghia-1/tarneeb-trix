// Pure, transport-agnostic lobby: it manages tables (waiting rooms) keyed by a short
// join code, seats humans as they join, and — when the host starts — hands off to a
// @tarneeb/room Room (empty seats auto-filled with bots). No sockets here, so it is
// fully unit-testable; the WebSocket layer in server.ts just calls these methods and
// broadcasts the results.
import {
  createRoom,
  type GameKind,
  type HumanEntry,
  type LobbyState,
  type PlayerId,
  type PublicSeat,
  type RedactedView,
  type RoomConfig,
  type RoomHandle,
  type Seat,
} from '@tarneeb/room';

interface Table {
  code: string;
  config: RoomConfig;
  hostId: PlayerId;
  humans: HumanEntry[]; // seating order; index === seat
  room: RoomHandle | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous O/0/I/1
const MAX_SEATS = 4;

export class Lobby {
  private readonly tables = new Map<string, Table>();

  private freshCode(): string {
    for (let tries = 0; tries < 1000; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.tables.has(code)) return code;
    }
    throw new Error('could not allocate a table code');
  }

  private table(code: string): Table {
    const t = this.tables.get(code);
    if (!t) throw new Error('no such table');
    return t;
  }

  createTable(host: HumanEntry, game: GameKind, partnership = false): string {
    const code = this.freshCode();
    this.tables.set(code, {
      code,
      config: { game, partnership },
      hostId: host.playerId,
      humans: [host],
      room: null,
    });
    return code;
  }

  /** Seat a human (idempotent for a returning playerId). Returns the seat index. */
  join(code: string, entry: HumanEntry): Seat {
    const t = this.table(code);
    const existing = t.humans.findIndex((h) => h.playerId === entry.playerId);
    if (existing >= 0) return existing as Seat;
    if (t.room) throw new Error('game already started');
    if (t.humans.length >= MAX_SEATS) throw new Error('table is full');
    t.humans.push(entry);
    return (t.humans.length - 1) as Seat;
  }

  /** Remove a human before the game starts (compacting seats). No-op after start. */
  leave(code: string, playerId: PlayerId): void {
    const t = this.tables.get(code);
    if (!t || t.room) return;
    t.humans = t.humans.filter((h) => h.playerId !== playerId);
    if (t.humans.length === 0) this.tables.delete(code);
    else if (t.hostId === playerId) t.hostId = t.humans[0]!.playerId; // host left → promote
  }

  start(code: string, playerId: PlayerId): void {
    const t = this.table(code);
    if (t.hostId !== playerId) throw new Error('only the host can start');
    if (t.room) throw new Error('already started');
    t.room = createRoom(t.config, t.humans);
  }

  submit(code: string, playerId: PlayerId, action: unknown): void {
    const t = this.table(code);
    if (!t.room) throw new Error('game has not started');
    t.room.submit(playerId, action);
  }

  seatOf(code: string, playerId: PlayerId): Seat | null {
    const t = this.tables.get(code);
    if (!t) return null;
    if (t.room) return t.room.seatOf(playerId);
    const i = t.humans.findIndex((h) => h.playerId === playerId);
    return i < 0 ? null : (i as Seat);
  }

  /** The human players seated here (recipients for broadcasts). */
  humansOf(code: string): readonly HumanEntry[] {
    return this.tables.get(code)?.humans ?? [];
  }

  viewFor(code: string, playerId: PlayerId): RedactedView | null {
    const t = this.tables.get(code);
    if (!t || !t.room) return null;
    const seat = t.room.seatOf(playerId);
    return seat === null ? null : t.room.viewFor(seat);
  }

  lobbyState(code: string): LobbyState {
    const t = this.table(code);
    const seats: PublicSeat[] = [];
    if (t.room) {
      for (const o of t.room.occupants) {
        seats.push(o.kind === 'human' ? { kind: 'human', name: o.name } : { kind: 'bot', name: o.name });
      }
    } else {
      for (let s = 0; s < MAX_SEATS; s++) {
        const h = t.humans[s];
        seats.push(h ? { kind: 'human', name: h.name } : { kind: 'empty', name: null });
      }
    }
    return {
      code: t.code,
      game: t.config.game,
      partnership: !!t.config.partnership,
      started: t.room !== null,
      hostId: t.hostId,
      seats,
    };
  }

  hasTable(code: string): boolean {
    return this.tables.has(code);
  }

  isStarted(code: string): boolean {
    return this.tables.get(code)?.room !== null && this.tables.get(code)?.room !== undefined;
  }
}
