// Wire protocol between the web client and the game server. All messages are JSON.
import type { GameKind, RedactedView } from '@tarneeb/room';
import type { LobbyState } from './lobby.js';

export type ClientMsg =
  | { readonly t: 'create'; readonly playerId: string; readonly name: string; readonly game: GameKind; readonly partnership?: boolean }
  | { readonly t: 'join'; readonly playerId: string; readonly name: string; readonly code: string }
  | { readonly t: 'start'; readonly playerId: string; readonly code: string }
  | { readonly t: 'action'; readonly playerId: string; readonly code: string; readonly action: unknown }
  | { readonly t: 'leave'; readonly playerId: string; readonly code: string };

export type ServerMsg =
  | { readonly t: 'lobby'; readonly state: LobbyState }
  | { readonly t: 'view'; readonly view: RedactedView }
  | { readonly t: 'error'; readonly message: string };
