import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { flushQueue } from '../lib/offlineSync';

const GameContext = createContext();

const initialState = {
  currentUser: null,
  currentGame: null,
  players: [],
  gameHistory: [],
  isLoading: false,
  error: null,
  lastUpdate: null,
};

const gameReducer = (state, action) => {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, currentUser: action.payload };

    case 'SET_GAME':
      return { ...state, currentGame: action.payload };

    case 'SET_PLAYERS':
      return { ...state, players: action.payload };

    case 'UPDATE_PLAYER_SCORE':
      return {
        ...state,
        players: state.players.map((p) =>
          p.player_id === action.payload.playerId
            ? { ...p, current_score: action.payload.newScore }
            : p
        ),
        lastUpdate: action.payload,
      };

    case 'ADD_PLAYER':
      return {
        ...state,
        players: [...state.players, action.payload],
      };

    case 'REMOVE_PLAYER':
      return {
        ...state,
        players: state.players.filter((p) => p.player_id !== action.payload),
      };

    case 'SET_GAME_HISTORY':
      return { ...state, gameHistory: action.payload };

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'UPDATE_GAME_STATUS':
      return {
        ...state,
        currentGame: { ...state.currentGame, status: action.payload },
      };

    default:
      return state;
  }
};

export const GameProvider = ({ children }) => {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  // Lifted here (rather than inside GameBoard) so the connection — and the
  // `isConnected` signal offline support relies on — persists across route
  // changes, matching the hook's own "kept alive across route changes" intent.
  const ws = useWebSocket();

  // Replay the offline outbox the moment we (re)connect, including the very
  // first connection of a session — a queue can be left over from a
  // previous session that ended while offline.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = ws.isConnected;
    if (!ws.isConnected || wasConnected) return;

    flushQueue({
      emitScoreChange: ws.emitScoreChange,
      onGameCreated: (localId, game) => {
        window.dispatchEvent(
          new CustomEvent('offlinesync:gamecreated', { detail: { localId, game } })
        );
      },
      onOpDropped: (op, error) => {
        console.warn('Dropped a queued offline change:', op.type, error);
        window.dispatchEvent(new CustomEvent('offlinesync:opdropped', { detail: { op, error } }));
      },
    });
  }, [ws.isConnected]);

  const value = {
    state,
    dispatch,
    ...ws,
    setUser: (user) => dispatch({ type: 'SET_USER', payload: user }),
    setGame: (game) => dispatch({ type: 'SET_GAME', payload: game }),
    setPlayers: (players) => dispatch({ type: 'SET_PLAYERS', payload: players }),
    updatePlayerScore: (playerId, newScore, changeAmount) =>
      dispatch({
        type: 'UPDATE_PLAYER_SCORE',
        payload: { playerId, newScore, changeAmount },
      }),
    addPlayer: (player) => dispatch({ type: 'ADD_PLAYER', payload: player }),
    removePlayer: (playerId) => dispatch({ type: 'REMOVE_PLAYER', payload: playerId }),
    setGameHistory: (history) => dispatch({ type: 'SET_GAME_HISTORY', payload: history }),
    setLoading: (loading) => dispatch({ type: 'SET_LOADING', payload: loading }),
    setError: (error) => dispatch({ type: 'SET_ERROR', payload: error }),
    updateGameStatus: (status) =>
      dispatch({ type: 'UPDATE_GAME_STATUS', payload: status }),
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
};

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};
