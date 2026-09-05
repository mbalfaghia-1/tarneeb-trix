// Public API of the game-room core. A server layer (WebSockets, etc.) wraps this;
// the room itself has no networking and is deterministic given the config seed.
export type { Seat } from '@tarneeb/engine';
export * from './types.js';
export { Room, createRoom } from './room.js';
export type { GameCtl } from './game-ctl.js';
