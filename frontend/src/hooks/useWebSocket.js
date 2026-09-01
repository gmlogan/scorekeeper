import { useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';

// Empty => connect to the same origin the page was served from (production).
// In dev, .env.development points this at the local backend.
const SOCKET_URL = import.meta.env.VITE_WS_URL ?? '';

export const useWebSocket = () => {
  const socketRef = useRef(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL || undefined);
    }

    return () => {
      // Don't disconnect on unmount - keep connection alive
      // socketRef.current?.disconnect();
    };
  }, []);

  const joinGame = useCallback((gameId, userId) => {
    socketRef.current?.emit('join-game', { gameId, userId });
  }, []);

  const leaveGame = useCallback((gameId, userId) => {
    socketRef.current?.emit('leave-game', { gameId, userId });
  }, []);

  const emitScoreUpdate = useCallback((gameId, playerId, newScore, changeAmount, editedBy) => {
    socketRef.current?.emit('score-updated', {
      gameId,
      playerId,
      newScore,
      changeAmount,
      editedBy,
    });
  }, []);

  const emitGameStateChange = useCallback((gameId, status) => {
    socketRef.current?.emit('game-state-changed', { gameId, status });
  }, []);

  const on = useCallback((event, callback) => {
    socketRef.current?.on(event, callback);
    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  return {
    socket: socketRef.current,
    joinGame,
    leaveGame,
    emitScoreUpdate,
    emitGameStateChange,
    on,
    isConnected: socketRef.current?.connected || false,
  };
};
