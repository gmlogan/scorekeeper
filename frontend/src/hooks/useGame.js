import { useCallback } from 'react';
import axios from 'axios';
import { useGame } from '../context/GameContext';

// Empty string => same-origin (production, served by the backend).
// In dev, .env.development points this at the local backend.
const API_URL = import.meta.env.VITE_API_URL ?? '';

// Create axios instance with default config
const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Add interceptor to include user headers
api.interceptors.request.use((config) => {
  const userId = localStorage.getItem('userId');
  const sessionToken = localStorage.getItem('sessionToken');

  if (userId) config.headers['x-user-id'] = userId;
  if (sessionToken) config.headers['x-session-token'] = sessionToken;

  return config;
});

export const useGameAPI = () => {
  const { setGame, setPlayers, setLoading, setError } = useGame();

  const createGame = useCallback(
    async (name, players, targetScore, timeLimit) => {
      try {
        setLoading(true);
        const response = await api.post('/games', {
          name,
          players,
          targetScore,
          timeLimit,
        });
        setGame(response.data);
        setPlayers(response.data.players);
        setError(null);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to create game');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setGame, setPlayers, setLoading, setError]
  );

  const joinGame = useCallback(
    async (code, username) => {
      try {
        setLoading(true);
        const response = await api.post('/games/join', { code, username });
        setGame(response.data.game);
        setPlayers(response.data.players);
        localStorage.setItem('userId', response.data.userId);
        setError(null);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to join game');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setGame, setPlayers, setLoading, setError]
  );

  const getGame = useCallback(
    async (gameId) => {
      try {
        setLoading(true);
        const response = await api.get(`/games/${gameId}`);
        setGame(response.data.game);
        setPlayers(response.data.players);
        setError(null);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to fetch game');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setGame, setPlayers, setLoading, setError]
  );

  const getGameByCode = useCallback(
    async (code) => {
      try {
        setLoading(true);
        const response = await api.get(`/games/code/${code}`);
        setGame(response.data.game);
        setPlayers(response.data.players);
        setError(null);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to fetch game');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setGame, setPlayers, setLoading, setError]
  );

  const updateScore = useCallback(
    async (gameId, playerId, changeAmount) => {
      try {
        const response = await api.post(
          `/scores/games/${gameId}/players/${playerId}/update`,
          { changeAmount }
        );
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to update score');
        throw error;
      }
    },
    [setError]
  );

  const setScore = useCallback(
    async (gameId, playerId, score) => {
      try {
        const response = await api.post(
          `/scores/games/${gameId}/players/${playerId}/set`,
          { score }
        );
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to set score');
        throw error;
      }
    },
    [setError]
  );

  const getScoreHistory = useCallback(async (gameId, playerId) => {
    try {
      const response = await api.get(
        `/scores/games/${gameId}/players/${playerId}/history`
      );
      return response.data;
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to fetch score history');
      throw error;
    }
  }, [setError]);

  const getLeaderboard = useCallback(
    async (gameId) => {
      try {
        const response = await api.get(`/scores/games/${gameId}/leaderboard`);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to fetch leaderboard');
        throw error;
      }
    },
    [setError]
  );

  const getUserGames = useCallback(
    async () => {
      try {
        setLoading(true);
        const response = await api.get('/games');
        setError(null);
        return response.data;
      } catch (error) {
        setError(error.response?.data?.error || 'Failed to fetch games');
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError]
  );

  const getHostedGames = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/games/hosted');
      setError(null);
      return response.data;
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to fetch games');
      throw error;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  const deleteHostedGames = useCallback(async () => {
    try {
      const response = await api.delete('/games/hosted');
      return response.data;
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to delete games');
      throw error;
    }
  }, [setError]);

  const updateDisplayName = useCallback(async (displayName) => {
    try {
      const response = await api.patch('/users/me', { displayName });
      return response.data;
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to update display name');
      throw error;
    }
  }, [setError]);

  return {
    createGame,
    joinGame,
    getGame,
    getGameByCode,
    updateScore,
    setScore,
    getScoreHistory,
    getLeaderboard,
    getUserGames,
    getHostedGames,
    deleteHostedGames,
    updateDisplayName,
  };
};
