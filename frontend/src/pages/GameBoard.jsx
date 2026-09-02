import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameAPI } from '../hooks/useGame';
import { useWebSocket } from '../hooks/useWebSocket';
import { useGame } from '../context/GameContext';
import { copyText } from '../lib/clipboard';

// SQLite timestamps are UTC "YYYY-MM-DD HH:MM:SS"
const formatEntryTime = (value) => {
  if (!value) return '';
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const GameBoard = () => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { getGame, updateScore, getScoreHistory, updateGameStatus } = useGameAPI();
  const { joinGame, on, emitScoreUpdate, emitGameStateChange } = useWebSocket();
  const { state, updatePlayerScore: updatePlayerScoreContext } = useGame();
  const [players, setPlayers] = useState([]);
  const [gameData, setGameData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [scoreInput, setScoreInput] = useState('1');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const userId = localStorage.getItem('userId');
  const selectedPlayerIdRef = useRef(null);

  useEffect(() => {
    selectedPlayerIdRef.current = selectedPlayer?.player_id ?? null;
  }, [selectedPlayer?.player_id]);

  const loadHistory = async (playerId) => {
    try {
      const rows = await getScoreHistory(gameId, playerId);
      // Most recent first; keep the last 5 entries only
      setHistory((rows || []).slice(0, 5));
    } catch (error) {
      console.error('Failed to load score history:', error);
      setHistory([]);
    }
  };

  useEffect(() => {
    // Fetch game + roster only. Does NOT re-join the socket room.
    const refreshGame = async () => {
      try {
        const data = await getGame(gameId);
        setGameData(data.game);
        setPlayers(data.players);
      } catch (error) {
        console.error('Failed to load game:', error);
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    refreshGame();
    joinGame(gameId, userId); // join the socket room once, on mount

    // Set up WebSocket listeners
    const unsubScore = on('score-updated', (data) => {
      setPlayers((prev) =>
        prev.map((p) =>
          p.player_id === data.playerId
            ? { ...p, current_score: data.newScore }
            : p
        )
      );
      setSelectedPlayer((prev) =>
        prev && prev.player_id === data.playerId
          ? { ...prev, current_score: data.newScore }
          : prev
      );
      if (selectedPlayerIdRef.current === data.playerId) {
        loadHistory(data.playerId);
      }
    });

    const unsubPlayerJoined = on('player-joined', (data) => {
      // Ignore the echo of our own join; only refresh when someone else joins
      if (data.userId === userId) return;
      refreshGame();
    });

    const unsubState = on('game-state-changed', (data) => {
      setGameData((prev) => (prev ? { ...prev, status: data.status } : prev));
    });

    return () => {
      unsubScore();
      unsubPlayerJoined();
      unsubState();
    };
  }, [gameId]);

  // Load the selected player's recent score entries
  useEffect(() => {
    if (selectedPlayer) {
      loadHistory(selectedPlayer.player_id);
    } else {
      setHistory([]);
    }
  }, [selectedPlayer?.player_id]);

  const status = gameData?.status || 'active';
  const isPaused = status === 'paused';
  const isFinished = status === 'finished';
  const isLocked = isPaused || isFinished;

  const applyDelta = (sign) => {
    if (isLocked) return;
    const parsed = parseInt(scoreInput, 10);
    const magnitude = Number.isNaN(parsed) ? 1 : Math.abs(parsed);
    handleScoreChange(sign * magnitude);
    // Reset to the default of 1 only after an add/sub, never while typing
    setScoreInput('1');
  };

  const handleScoreChange = async (amount) => {
    if (!selectedPlayer || isLocked) return;

    try {
      const result = await updateScore(gameId, selectedPlayer.player_id, amount);
      setPlayers((prev) =>
        prev.map((p) =>
          p.player_id === selectedPlayer.player_id
            ? { ...p, current_score: result.newScore }
            : p
        )
      );
      setSelectedPlayer({ ...selectedPlayer, current_score: result.newScore });
      loadHistory(selectedPlayer.player_id);
      // Tell the other players in this game
      emitScoreUpdate(
        gameId,
        selectedPlayer.player_id,
        result.newScore,
        amount,
        userId
      );
    } catch (error) {
      console.error('Failed to update score:', error);
    }
  };

  const isHost = gameData?.host_id === userId;
  const isOwnScore = selectedPlayer?.player_id === userId;

  const changeStatus = async (next) => {
    const prompts = {
      paused:
        'Pause the game for everyone? Players will not be able to change scores until you resume.',
      finished:
        'End the game for everyone? Final scores will be locked and this cannot be undone.',
    };
    if (prompts[next] && !window.confirm(prompts[next])) return;

    try {
      const updated = await updateGameStatus(gameId, next);
      setGameData((prev) => ({ ...(prev || {}), ...updated }));
      emitGameStateChange(gameId, next); // tell everyone else in the room
    } catch (error) {
      console.error('Failed to update game status:', error);
      alert(error.response?.data?.error || 'Failed to update the game');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Loading game...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/games')}
            aria-label="Back to active games"
            className="shrink-0 w-9 h-9 flex items-center justify-center bg-gray-100 rounded-full text-lg leading-none hover:bg-gray-200 transition-colors"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight truncate">
              {gameData?.name}
            </h1>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-semibold">Code: {gameData?.code}</span>
              <button
                onClick={() => copyText(gameData?.code)}
                className="font-semibold text-primary hover:text-primary-dark"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Game state banner — shown to everyone */}
      {isLocked && (
        <div
          className={`px-6 py-3 text-center text-sm font-semibold ${
            isFinished
              ? 'bg-gray-900 text-white'
              : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {isFinished
            ? '🔚 This game has ended — final scores are locked'
            : '⏸ Game paused by the host — scoring is locked'}
        </div>
      )}

      <div className="px-6 py-6 max-w-2xl mx-auto space-y-6">
        {/* Leaderboard */}
        <div>
          <h2 className="text-xl font-bold mb-4">Leaderboard</h2>
          <div className="space-y-3">
            {players
              .sort((a, b) => b.current_score - a.current_score)
              .map((player, index) => (
                <div
                  key={player.player_id}
                  onClick={() => setSelectedPlayer(player)}
                  className={`card cursor-pointer transition-all ${
                    selectedPlayer?.player_id === player.player_id
                      ? 'ring-2 ring-primary bg-primary bg-opacity-5'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 text-center font-bold text-lg text-gray-500 w-8">
                        #{index + 1}
                      </div>
                      <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm">
                        {player.display_name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold">{player.display_name}</h3>
                        {player.player_id === userId && (
                          <p className="text-xs text-gray-500">(You)</p>
                        )}
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-primary">
                      {player.current_score}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Score Entry */}
        {selectedPlayer && (
          <div className="card">
            <h2 className="text-xl font-bold mb-4">
              {isOwnScore
                ? 'Update your score'
                : `${selectedPlayer.display_name}'s score`}
            </h2>

            {/* Current Score Display */}
            <div className="bg-gray-100 rounded-2xl p-6 text-center mb-6">
              <p className="text-gray-600 text-sm mb-1">Current Score</p>
              <p className="text-5xl font-bold text-primary">
                {selectedPlayer.current_score}
              </p>
            </div>

            {/* Score adjustment — only the owner of this score, and only while the game is active */}
            {isOwnScore && !isLocked && (
              <div className="flex gap-2">
                <button
                  onClick={() => applyDelta(-1)}
                  className="py-3 px-6 rounded-xl font-bold text-2xl bg-red-100 text-red-700 hover:bg-red-200"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={scoreInput}
                  onChange={(e) => setScoreInput(e.target.value)}
                  className="input-field flex-1 text-center text-lg font-bold"
                />
                <button
                  onClick={() => applyDelta(1)}
                  className="py-3 px-6 rounded-xl font-bold text-2xl bg-green-100 text-green-700 hover:bg-green-200"
                >
                  +
                </button>
              </div>
            )}
            {isOwnScore && isLocked && (
              <p className="text-sm text-gray-500 bg-gray-100 rounded-xl px-4 py-3 text-center">
                {isFinished
                  ? 'The game has ended. Scores can no longer be changed.'
                  : 'The game is paused. You can change scores again once the host resumes.'}
              </p>
            )}

            {/* Last 5 score entries (the amount added/subtracted, not the total) */}
            {history.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-gray-600 mb-2">
                  Recent entries
                </p>
                <div className="divide-y divide-gray-100">
                  {history.map((h, i) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span
                        className={`font-bold w-14 ${
                          h.change_amount >= 0
                            ? 'text-green-600'
                            : 'text-red-600'
                        }`}
                      >
                        {h.change_amount >= 0 ? '+' : ''}
                        {h.change_amount}
                      </span>
                      <span className="flex-1 text-gray-600">
                        {i === 0 ? 'Latest' : `${i + 1} entries ago`}
                      </span>
                      <span className="text-gray-400">
                        {formatEntryTime(h.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Host Controls — only the game creator sees these */}
        {isHost && (
          <div className="card border-2 border-primary border-opacity-50">
            <h2 className="text-lg font-bold mb-3">Host Controls</h2>

            {isFinished ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  This game has ended. Final scores are locked for everyone.
                </p>
                <button
                  onClick={() => navigate('/')}
                  className="btn-secondary w-full"
                >
                  Back to home
                </button>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => changeStatus(isPaused ? 'active' : 'paused')}
                  className="btn-secondary flex-1 py-2"
                >
                  {isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button
                  onClick={() => changeStatus('finished')}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-full transition-all"
                >
                  ⏹ Stop
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
