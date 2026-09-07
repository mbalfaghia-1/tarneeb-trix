import type { Seat } from '@tarneeb/engine';

export type GameKind = 'tarneeb' | 'trix' | 'trixComplex';
export type PlayerId = string;

/** A table seat is held by a human (with a stable player id) or filled by a bot. */
export type SeatOccupant =
  | { readonly kind: 'human'; readonly playerId: PlayerId; readonly name: string }
  | { readonly kind: 'bot'; readonly name: string };

export interface RoomConfig {
  readonly game: GameKind;
  /** Trix only: decide the winner by summed team totals (seats 0+2 vs 1+3). */
  readonly partnership?: boolean;
  /** Deterministic deal seed; random when omitted. */
  readonly seed?: number;
  /**
   * Paced mode (online): the room does NOT auto-run bot/seatless turns itself. It applies
   * only the action it is given and leaves any pending bot/auto step for the caller to
   * drive one at a time (with delays), so remote players see cards played one-by-one and
   * the between-deals summary. Off (default) → the room settles to the next human at once
   * (single-use / tests).
   */
  readonly paced?: boolean;
}

/** What the next step in a paced room would be, without applying it. */
export type StepKind = 'human' | 'bot' | 'auto' | 'terminal';

/** Pacing hint for the CURRENT position, so a paced driver can pick the right delay:
 *  'deal' = a between-deals/hands summary is showing (long pause), 'trick' = a trick just
 *  completed and the table is about to lead the next one (review pause), 'normal' = an
 *  ordinary bot move. */
export type PaceHint = 'deal' | 'trick' | 'normal';

/** One human joining a room, in seating order (seat 0 first). */
export interface HumanEntry {
  readonly playerId: PlayerId;
  readonly name: string;
}

/**
 * What a single seat is allowed to see. The viewer's own hand is real; every other
 * hand is emptied in `state` and only its size is exposed via `handCounts`, so a
 * client can never receive another player's cards. `state` is the redacted game
 * state (same shape the single-player UI already renders).
 */
export interface RedactedView {
  readonly seat: Seat;
  readonly game: GameKind;
  readonly you: SeatOccupant;
  readonly occupants: readonly SeatOccupant[];
  readonly handCounts: readonly number[];
  /** Seat whose action the game is waiting on, or null when auto-advancing/terminal. */
  readonly awaitingSeat: Seat | null;
  readonly yourTurn: boolean;
  readonly terminal: boolean;
  readonly state: unknown;
}

/** The public, transport-agnostic handle a server wraps with a socket layer. */
export interface RoomHandle {
  readonly config: RoomConfig;
  readonly occupants: readonly SeatOccupant[];
  /** Seat held by this player, or null if they are not seated here. */
  seatOf(playerId: PlayerId): Seat | null;
  /** Redacted view for a seat. */
  viewFor(seat: Seat): RedactedView;
  /** Apply a human action. Throws if it is not that player's turn or not legal. */
  submit(playerId: PlayerId, action: unknown): void;
  /** Auto-play the current turn with the bot brain (for a stalled/disconnected human).
   *  Returns true if a human turn was played, false if it was a bot/terminal. */
  forceCurrentTurn(): boolean;
  /** Convert a human seat to a bot (they left the game); keeps the seat's name and
   *  immediately plays it out if it is that seat's turn. Returns true if a human was
   *  vacated, false if the seat was already a bot / out of range. */
  vacateSeat(seat: Seat): boolean;
  /** Paced driver: what the next step would be, without applying it. */
  peekNext(): StepKind;
  /** Paced driver: apply exactly ONE pending bot/seatless-auto step. Returns what it did
   *  ('human'/'terminal' = nothing applied). */
  stepAuto(): StepKind;
  /** Paced driver: pacing hint for the current position (pick the pre-step delay). */
  paceHint(): PaceHint;
  awaitingSeat(): Seat | null;
  isTerminal(): boolean;
  /** Full un-redacted state — server/debug use only, never send to a client. */
  rawState(): unknown;
}
