import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface OnlineGame {
  status: OnlineStatus;
  error: string | null;
  lobby: LobbyState | null;
  view: RedactedView | null;
  me: string;
  create: (game: GameKind, partnership: boolean, name: string) => void;
  join: (code: string, name: string) => void;
  start: () => void;
  leave: () => void;
  submit: (action: unknown) => void;
}

export function useOnlineGame(): OnlineGame {
  const me = useRef(loadPlayerId());
  const ws = useRef<WebSocket | null>(null);
  const code = useRef<string | null>(loadCode());
  const queue = useRef<ClientMsg[]>([]);
  const [status, setStatus] = useState<OnlineStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [view, setView] = useState<RedactedView | null>(null);

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
        setView(msg.view);
      } else if (msg.t === 'error') {
        setError(msg.message);
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
      if (code.current) send({ t: 'action', playerId: me.current, code: code.current, action });
    },
    [send],
  );

  return { status, error, lobby, view, me: me.current, create, join, start, leave, submit };
}
