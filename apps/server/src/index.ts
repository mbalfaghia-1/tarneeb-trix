import { createGameServer } from './server.js';

const port = Number(process.env.PORT ?? 8787);
createGameServer(port);
// eslint-disable-next-line no-console
console.log(`Tarneeb/Trix game server listening on ws://localhost:${port}`);
