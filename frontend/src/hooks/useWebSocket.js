import { useCallback, useEffect, useRef, useState } from 'react';

// Raw WebSocket transport (no Socket.io). One connection per tab, kept alive
// across route changes, with its own reconnect/backoff. Messages are JSON
// `{ type, ... }`. This mirrors what a Cloudflare Durable Object would speak,
// so the client is portable off Node without changes.
const RAW_WS_URL = import.meta.env.VITE_WS_URL ?? '';
const ACK_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10000;

const endpoint = () => {
  if (RAW_WS_URL) {
    return RAW_WS_URL.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

// Browsers can't set headers on a WebSocket, so the bearer token is carried
// as the second subprotocol: new WebSocket(url, ['bearer', <token>]).
const authProtocols = () => {
  try {
    const token = localStorage.getItem('sessionToken');
    return token ? ['bearer', token] : [];
  } catch (_) {
    return [];
  }
};

export const useWebSocket = () => {
  const wsRef = useRef(null);
  const handlersRef = useRef(new Map()); // type -> Set<cb>
  const outboxRef = useRef([]); // frames queued while not OPEN
  const acksRef = useRef(new Map()); // reqId -> { resolve, timer }
  const reqSeqRef = useRef(0);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);

  const send = useCallback((obj) => {
    const data = JSON.stringify(obj);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    else outboxRef.current.push(data);
  }, []);

  const fire = useCallback((type, msg) => {
    const set = handlersRef.current.get(type);
    if (!set) return;
    set.forEach((cb) => {
      try {
        cb(msg);
      } catch (err) {
        console.error(`ws handler for "${type}" threw:`, err);
      }
    });
  }, []);

  const dispatch = useCallback(
    (msg) => {
      if (msg.type === 'ack') {
        const pending = acksRef.current.get(msg.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          acksRef.current.delete(msg.reqId);
          pending.resolve(msg);
        }
        return;
      }
      fire(msg.type, msg);
    },
    [fire]
  );

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      const ws = new WebSocket(endpoint(), authProtocols());
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setIsConnected(true);
        const queued = outboxRef.current;
        outboxRef.current = [];
        queued.forEach((d) => ws.send(d));
        fire('open', { type: 'open' });
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        dispatch(msg);
      };

      ws.onclose = () => {
        // Ignore stale sockets (StrictMode remount / superseded connections).
        if (wsRef.current !== ws) return;
        setIsConnected(false);
        if (closedRef.current) return;
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** retryRef.current,
          RECONNECT_MAX_MS
        );
        retryRef.current += 1;
        setTimeout(() => {
          if (!closedRef.current) connect();
        }, delay);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch (_) {
          /* onclose will follow */
        }
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      try {
        wsRef.current?.close();
      } catch (_) {
        /* ignore */
      }
    };
  }, [dispatch, fire]);

  const on = useCallback((type, callback) => {
    let set = handlersRef.current.get(type);
    if (!set) {
      set = new Set();
      handlersRef.current.set(type, set);
    }
    set.add(callback);
    return () => set.delete(callback);
  }, []);

  const joinGame = useCallback((gameId) => send({ type: 'join', gameId }), [send]);

  const leaveGame = useCallback((gameId) => send({ type: 'leave', gameId }), [send]);

  const requestResync = useCallback(
    (gameId) => send({ type: 'resync', gameId }),
    [send]
  );

  // Resolves with the server ack: { ok: true, newScore, previousScore }
  // or { ok: false, error }.
  const emitScoreChange = useCallback(
    (gameId, playerId, changeAmount) => {
      return new Promise((resolve) => {
        const reqId = `r${(reqSeqRef.current += 1)}`;
        const timer = setTimeout(() => {
          acksRef.current.delete(reqId);
          resolve({ ok: false, error: 'Timed out waiting for the server' });
        }, ACK_TIMEOUT_MS);
        acksRef.current.set(reqId, { resolve, timer });
        send({ type: 'score:change', gameId, playerId, changeAmount, reqId });
      });
    },
    [send]
  );

  return {
    joinGame,
    leaveGame,
    requestResync,
    emitScoreChange,
    on,
    isConnected,
  };
};
