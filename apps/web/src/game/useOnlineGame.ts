import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyAction,
  applyTrixAction,
  type TarneebAction,
  type TarneebState,
  type TrixAction,
  type TrixState,
} from '@tarneeb/engine';
import type { ClientMsg, GameKind, LobbyState, RedactedView, ServerMsg } from '@tarneeb/room';

const SERVER_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ||
  'ws://localhost:8787';

/** A stable per-device player id so the same person keeps their seat across reloads. */
function loadPlayerId(): string {
  const rnd = () => Math.random().toString(36).slice(2, 10);
  try {
    let id = localStorage.getItem('tarneeb.playerId');
    if (!id) {
      id = rnd();
      localStorage.setItem('tarneeb.playerId', id);
    }
    return id;
  } catch {
    return rnd();
  }
}

const CODE_KEY = 'tarneeb.tableCode';
const loadCode = (): string | null => {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
};
const saveCode = (c: string | null) => {
  try {
    if (c) localStorage.setItem(CODE_KEY, c);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
};

export type OnlineStatus = 'connecting' | 'online' | 'error';

export interface QueuedInfo {
  game: GameKind;
  partnership: boolean;
  size: number;
  needed: number;
  names: readonly string[];
}

export interface OnlineGame {
  status: OnlineStatus;
  error: string | null;
  lobby: LobbyState | null;
  view: RedactedView | null;
  queued: QueuedInfo | null;
  me: string;
  create: (game: GameKind, partnership: boolean, name: string) => void;
  join: (code: string, name: string) => void;
  start: () => void;
  leave: () => void;
  submit: (action: unknown) => void;
  quickMatch: (game: GameKind, partnership: boolean, name: string) => void;
  matchNow: () => void;
  cancelMatch: () => void;
}

export function useOnlineGame(): OnlineGame {
  const me = useRef(loadPlayerId());
  const ws = useRef<WebSocket | null>(null);
  const code = useRef<string | null>(loadCode());
  const queue = useRef<ClientMsg[]>([]);
  const bucket = useRef<{ game: GameKind; partnership: boolean } | null>(null);
  const lastServerView = useRef<RedactedView | null>(null); // authoritative view, to revert a rejected optimistic move
  const [status, setStatus] = useState<OnlineStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [view, setView] = useState<RedactedView | null>(null);
  const [queued, setQueued] = useState<QueuedInfo | null>(null);

  useEffect(() => {
    let disposed = false; // ignore events from a socket torn down by StrictMode's re-mount
    const socket = new WebSocket(SERVER_URL);
    ws.current = socket;
    socket.onopen = () => {
      if (disposed) return;
      setStatus('online');
      setError(null);
      // Re-attach to an in-progress table after a reconnect/reload.
      if (code.current) socket.send(JSON.stringify({ t: 'hello', playerId: me.current, code: code.current }));
      for (const m of queue.current) socket.send(JSON.stringify(m));
      queue.current = [];
    };
    socket.onclose = () => {
      if (!disposed) setStatus('error');
    };
    socket.onerror = () => {
      if (!disposed) {
        setStatus('error');
        setError('Could not reach the game server.');
      }
    };
    socket.onmessage = (ev) => {
      if (disposed) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'lobby') {
        setLobby(msg.state);
        code.current = msg.state.code;
        saveCode(msg.state.code);
        if (!msg.state.started) setView(null);
      } else if (msg.t === 'view') {
        code.current = msg.code; // quick-match sends no 'lobby', so learn the code here
        saveCode(msg.code);
        lastServerView.current = msg.view; // authoritative
        setView(msg.view);
        setQueued(null); // matched → game started
      } else if (msg.t === 'queued') {
        setQueued({
          game: msg.game,
          partnership: msg.partnership,
          size: msg.size,
          needed: msg.needed,
          names: msg.names,
        });
      } else if (msg.t === 'error') {
        setError(msg.message);
        if (lastServerView.current) setView(lastServerView.current); // revert a rejected optimistic move
        if (msg.message === 'table not found') {
          code.current = null;
          saveCode(null);
          setLobby(null);
          setView(null);
        }
      }
    };
    return () => {
      disposed = true;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, []);

  const send = useCallback((m: ClientMsg) => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(m));
    else queue.current.push(m);
  }, []);

  const create = useCallback(
    (game: GameKind, partnership: boolean, name: string) => {
      setError(null);
      send({ t: 'create', playerId: me.current, name, game, partnership });
    },
    [send],
  );
  const join = useCallback(
    (c: string, name: string) => {
      setError(null);
      code.current = c.toUpperCase();
      saveCode(code.current);
      send({ t: 'join', playerId: me.current, name, code: code.current });
    },
    [send],
  );
  const start = useCallback(() => {
    if (code.current) send({ t: 'start', playerId: me.current, code: code.current });
  }, [send]);
  const leave = useCallback(() => {
    if (code.current) send({ t: 'leave', playerId: me.current, code: code.current });
    setLobby(null);
    setView(null);
    code.current = null;
    saveCode(null);
  }, [send]);
  const submit = useCallback(
    (action: unknown) => {
      if (!code.current) return;
      send({ t: 'action', playerId: me.current, code: code.current, action });
      // Optimistic: apply our own move locally for instant feedback (the card leaves
      // the hand / lands on the table now, not after a round-trip). The server's next
      // view is authoritative and replaces this; a rejection reverts (see 'error').
      setView((v) => {
        if (!v) return v;
        try {
          const next =
            v.game === 'tarneeb'
              ? applyAction(v.state as TarneebState, action as TarneebAction)
              : applyTrixAction(v.state as TrixState, action as TrixAction);
          return { ...v, state: next, yourTurn: false };
        } catch {
          return v; // if it doesn't apply cleanly, just wait for the server
        }
      });
    },
    [send],
  );
  const quickMatch = useCallback(
    (game: GameKind, partnership: boolean, name: string) => {
      setError(null);
      bucket.current = { game, partnership };
      setQueued({ game, partnership, size: 1, needed: 4, names: [name] });
      send({ t: 'quickmatch', playerId: me.current, name, game, partnership });
    },
    [send],
  );
  const matchNow = useCallback(() => {
    const b = bucket.current;
    if (b) send({ t: 'matchnow', playerId: me.current, game: b.game, partnership: b.partnership });
  }, [send]);
  const cancelMatch = useCallback(() => {
    const b = bucket.current;
    if (b) send({ t: 'cancelmatch', playerId: me.current, game: b.game, partnership: b.partnership });
    bucket.current = null;
    setQueued(null);
  }, [send]);

  return {
    status,
    error,
    lobby,
    view,
    queued,
    me: me.current,
    create,
    join,
    start,
    leave,
    submit,
    quickMatch,
    matchNow,
    cancelMatch,
  };
}
