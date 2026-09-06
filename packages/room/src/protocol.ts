// The wire protocol shared by the game server and the web client. All messages are
// JSON. Kept in @tarneeb/room so both sides import a single source of truth.
import type { GameKind, PlayerId, RedactedView } from './types.js';

export interface PublicSeat {
  readonly kind: 'human' | 'bot' | 'empty';
  readonly name: string | null;
}

export interface LobbyState {
  readonly code: string;
  readonly game: GameKind;
  readonly partnership: boolean;
  readonly started: boolean;
  readonly hostId: PlayerId;
  readonly seats: readonly PublicSeat[];
}

export type ClientMsg =
  | { readonly t: 'create'; readonly playerId: PlayerId; readonly name: string; readonly game: GameKind; readonly partnership?: boolean }
  | { readonly t: 'join'; readonly playerId: PlayerId; readonly name: string; readonly code: string }
  | { readonly t: 'hello'; readonly playerId: PlayerId; readonly code: string } // re-attach a reconnected socket
  | { readonly t: 'start'; readonly playerId: PlayerId; readonly code: string }
  | { readonly t: 'action'; readonly playerId: PlayerId; readonly code: string; readonly action: unknown }
  | { readonly t: 'leave'; readonly playerId: PlayerId; readonly code: string }
  // public matchmaking (play with strangers)
  | { readonly t: 'quickmatch'; readonly playerId: PlayerId; readonly name: string; readonly game: GameKind; readonly partnership?: boolean }
  | { readonly t: 'matchnow'; readonly playerId: PlayerId; readonly game: GameKind; readonly partnership?: boolean }
  | { readonly t: 'cancelmatch'; readonly playerId: PlayerId; readonly game: GameKind; readonly partnership?: boolean };

export type ServerMsg =
  | { readonly t: 'lobby'; readonly state: LobbyState }
  | { readonly t: 'view'; readonly view: RedactedView }
  | { readonly t: 'queued'; readonly game: GameKind; readonly partnership: boolean; readonly size: number; readonly needed: number; readonly names: readonly string[] }
  | { readonly t: 'error'; readonly message: string };
