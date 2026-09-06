import type { Seat } from '@tarneeb/engine';
import { tarneebCtl, makeTrixCtl, type GameCtl } from './game-ctl.js';
import type {
  HumanEntry,
  PlayerId,
  RedactedView,
  RoomConfig,
  RoomHandle,
  SeatOccupant,
} from './types.js';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** Order-independent structural equality, for matching a submitted action against
 *  the engine's legal-action list regardless of key order or object identity. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * A single game table. The engine is authoritative: the room applies bot moves and
 * seatless auto-transitions itself, and accepts a human action only when it is that
 * seat's turn and the action is legal. Views are redacted per seat.
 */
export class Room<S, A> implements RoomHandle {
  readonly config: RoomConfig;
  readonly occupants: readonly SeatOccupant[];
  private readonly ctl: GameCtl<S, A>;
  private state: S;

  constructor(config: RoomConfig, ctl: GameCtl<S, A>, occupants: readonly SeatOccupant[], state: S) {
    this.config = config;
    this.ctl = ctl;
    this.occupants = occupants;
    this.state = state;
    this.advance();
  }

  /** Play out every bot turn and seatless auto-transition until a human must act
   *  (or the game ends). */
  private advance(): void {
    // Bounded to protect against any non-terminating rule bug.
    for (let guard = 0; guard < 100_000; guard++) {
      const legal = this.ctl.legalActions(this.state);
      if (legal.length === 0) return; // terminal
      const auto = legal.find((a) => this.ctl.actorOf(a) === null);
      if (auto) {
        this.state = this.ctl.apply(this.state, auto);
        continue;
      }
      const actor = this.ctl.actorOf(legal[0]!);
      if (actor === null) return; // defensive; shouldn't happen
      if (this.occupants[actor]!.kind === 'bot') {
        this.state = this.ctl.apply(this.state, this.ctl.botAction(this.state));
        continue;
      }
      return; // a human's turn
    }
    throw new Error('room advance did not settle');
  }

  awaitingSeat(): Seat | null {
    const legal = this.ctl.legalActions(this.state);
    if (legal.length === 0) return null;
    return this.ctl.actorOf(legal[0]!);
  }

  isTerminal(): boolean {
    return this.ctl.legalActions(this.state).length === 0;
  }

  seatOf(playerId: PlayerId): Seat | null {
    const i = this.occupants.findIndex((o) => o.kind === 'human' && o.playerId === playerId);
    return i < 0 ? null : (i as Seat);
  }

  viewFor(seat: Seat): RedactedView {
    const awaiting = this.awaitingSeat();
    return {
      seat,
      game: this.config.game,
      you: this.occupants[seat]!,
      occupants: this.occupants,
      handCounts: this.ctl.handCounts(this.state),
      awaitingSeat: awaiting,
      yourTurn: awaiting === seat,
      terminal: this.isTerminal(),
      state: this.ctl.redact(this.state, seat),
    };
  }

  submit(playerId: PlayerId, action: unknown): void {
    const seat = this.seatOf(playerId);
    if (seat === null) throw new Error('player is not seated in this room');
    const legal = this.ctl.legalActions(this.state);
    const match = legal.find((a) => deepEqual(a, action));
    if (!match) throw new Error('illegal action or not this seat’s turn');
    if (this.ctl.actorOf(match) !== seat) throw new Error('cannot act for another seat');
    this.state = this.ctl.apply(this.state, match);
    this.advance();
  }

  rawState(): unknown {
    return this.state;
  }
}

/** Build occupants for seats 0..3: humans in join order, the rest filled with bots. */
function seatOccupants(humans: readonly HumanEntry[]): SeatOccupant[] {
  return SEATS.map((s) => {
    const h = humans[s];
    return h
      ? { kind: 'human' as const, playerId: h.playerId, name: h.name }
      : { kind: 'bot' as const, name: `Bot ${s + 1}` };
  });
}

/** Create a ready-to-play room. Empty seats are filled with bots; play is advanced
 *  to the first human decision (or straight to the end if the table is all bots). */
export function createRoom(config: RoomConfig, humans: readonly HumanEntry[] = []): RoomHandle {
  if (humans.length > 4) throw new Error('a table seats at most 4 players');
  const occupants = seatOccupants(humans);
  if (config.game === 'tarneeb') {
    return new Room(config, tarneebCtl, occupants, tarneebCtl.create(config.seed));
  }
  const ctl = makeTrixCtl(config.game === 'trixComplex' ? 'complex' : 'regular', !!config.partnership);
  return new Room(config, ctl, occupants, ctl.create(config.seed));
}
