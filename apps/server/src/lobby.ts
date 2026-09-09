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
  type PaceHint,
  type PlayerId,
  type PublicSeat,
  type RedactedView,
  type RoomConfig,
  type RoomHandle,
  type Seat,
  type StepKind,
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

const bucketKey = (game: GameKind, partnership: boolean): string => `${game}:${partnership ? 1 : 0}`;

export class Lobby {
  private readonly tables = new Map<string, Table>();
  // Public matchmaking queues, keyed by game + partnership.
  private readonly queues = new Map<string, HumanEntry[]>();

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

  /** A player leaves the table. Before start, their seat is freed and seats compact.
   *  After start, their seat is handed to a bot (the game continues for everyone else);
   *  the table is discarded once no humans remain. */
  leave(code: string, playerId: PlayerId): void {
    const t = this.tables.get(code);
    if (!t) return;
    if (t.room) {
      const seat = t.room.seatOf(playerId);
      if (seat !== null) t.room.vacateSeat(seat);
      t.humans = t.humans.filter((h) => h.playerId !== playerId); // stop broadcasting to them
      if (t.humans.length === 0) this.tables.delete(code); // all-bot table: nothing to serve
      return;
    }
    t.humans = t.humans.filter((h) => h.playerId !== playerId);
    if (t.humans.length === 0) this.tables.delete(code);
    else if (t.hostId === playerId) t.hostId = t.humans[0]!.playerId; // host left → promote
  }

  start(code: string, playerId: PlayerId): void {
    const t = this.table(code);
    if (t.hostId !== playerId) throw new Error('only the host can start');
    if (t.room) throw new Error('already started');
    t.room = createRoom({ ...t.config, holdDeals: true }, t.humans); // fast within a deal; pause only at deal boundaries
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

  // --- public matchmaking ---

  /** Add a player to a game's public queue (idempotent). Returns the queue size. */
  enqueue(game: GameKind, partnership: boolean, entry: HumanEntry): number {
    const key = bucketKey(game, partnership);
    const q = this.queues.get(key) ?? [];
    if (!q.some((e) => e.playerId === entry.playerId)) q.push(entry);
    this.queues.set(key, q);
    return q.length;
  }

  dequeue(game: GameKind, partnership: boolean, playerId: PlayerId): void {
    const key = bucketKey(game, partnership);
    const q = this.queues.get(key);
    if (q) this.queues.set(key, q.filter((e) => e.playerId !== playerId));
  }

  queueSize(game: GameKind, partnership: boolean): number {
    return this.queues.get(bucketKey(game, partnership))?.length ?? 0;
  }

  queuedPlayers(game: GameKind, partnership: boolean): readonly HumanEntry[] {
    return this.queues.get(bucketKey(game, partnership)) ?? [];
  }

  /**
   * Pull up to four queued players into a fresh, already-started table (empty seats
   * become bots). Returns the new table code and the humans seated, or null if the
   * queue is empty.
   */
  formMatch(game: GameKind, partnership: boolean): { code: string; humans: HumanEntry[] } | null {
    const key = bucketKey(game, partnership);
    const q = this.queues.get(key) ?? [];
    if (q.length === 0) return null;
    const humans = q.slice(0, 4);
    this.queues.set(key, q.slice(4));
    const code = this.freshCode();
    const config: RoomConfig = { game, partnership };
    this.tables.set(code, {
      code,
      config,
      hostId: humans[0]!.playerId,
      humans,
      room: createRoom({ ...config, holdDeals: true }, humans), // fast within a deal; pause only at deal boundaries
    });
    return { code, humans };
  }

  /** The seat whose turn it is, if that seat is a human (else null) — for turn timeouts. */
  awaitingHumanSeat(code: string): Seat | null {
    const room = this.tables.get(code)?.room;
    if (!room) return null;
    const seat = room.awaitingSeat();
    return seat !== null && room.occupants[seat]?.kind === 'human' ? seat : null;
  }

  /** Auto-play the current (stalled) human turn with the bot brain. */
  forceTurn(code: string): boolean {
    return this.tables.get(code)?.room?.forceCurrentTurn() ?? false;
  }

  // --- paced driver (online) -------------------------------------------------

  /** What the next step would be without applying it ('human'/'bot'/'auto'/'terminal'). */
  peekNext(code: string): StepKind | null {
    return this.tables.get(code)?.room?.peekNext() ?? null;
  }

  /** Apply exactly one pending bot/seatless-auto step. */
  stepAuto(code: string): StepKind | null {
    return this.tables.get(code)?.room?.stepAuto() ?? null;
  }

  /** Pacing hint for the current position (pick the pre-step delay). */
  paceHint(code: string): PaceHint | null {
    return this.tables.get(code)?.room?.paceHint() ?? null;
  }

  /** holdDeals: advance past the paused deal boundary and settle the next deal at once. */
  resumeDeal(code: string): void {
    this.tables.get(code)?.room?.resumeDeal();
  }

  hasTable(code: string): boolean {
    return this.tables.has(code);
  }

  isStarted(code: string): boolean {
    return this.tables.get(code)?.room !== null && this.tables.get(code)?.room !== undefined;
  }
}
