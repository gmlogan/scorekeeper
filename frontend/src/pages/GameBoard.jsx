import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameAPI } from '../hooks/useGame';
import { useWebSocket } from '../hooks/useWebSocket';
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
  const { getGame, updateGameStatus } = useGameAPI();
  const { joinGame, leaveGame, on, emitScoreChange, requestResync } = useWebSocket();
  const [players, setPlayers] = useState([]);
  const [gameData, setGameData] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [scoreInput, setScoreInput] = useState('1');
  // Last few score entries per player, seeded and kept live by `game:state`.
  const [historyByPlayer, setHistoryByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const userId = localStorage.getItem('userId');
  const scoreRequestIdRef = useRef(0);
  // Version of the last `game:state` frame we applied; frames that aren't
  // strictly newer are ignored (guards against out-of-order delivery).
  const stateVersionRef = useRef(0);

  // Pull the authoritative game + roster once for a deterministic first paint.
  // All later updates arrive over the socket as `game:state`.
  const reconcileFromRest = async () => {
    const data = await getGame(gameId);
    setGameData(data.game);
    setPlayers(data.players);
    setSelectedPlayer((prev) =>
      prev ? data.players.find((p) => p.player_id === prev.player_id) || null : prev
    );
    return data;
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getGame(gameId);
        // Only seed from REST if a socket frame hasn't already landed.
        if (!cancelled && stateVersionRef.current === 0) {
          setGameData(data.game);
          setPlayers(data.players);
        }
      } catch (error) {
        console.error('Failed to load game:', error);
        if (!cancelled) navigate('/');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    joinGame(gameId); // identity comes from the socket's bearer token

    // Full authoritative frame: join, resync reply, or a roster/status change.
    const applyFull = (state) => {
      if (!state || state.version < stateVersionRef.current) return;
      stateVersionRef.current = state.version;

      setGameData((prev) => ({ ...(prev || {}), ...state.game }));
      setPlayers(state.players);
      setHistoryByPlayer(state.history || {});
      setSelectedPlayer((prev) =>
        prev ? state.players.find((p) => p.player_id === prev.player_id) || null : prev
      );
      setLoading(false);
    };

    // Incremental score frame. Must arrive exactly one version after the last
    // applied frame; a gap means we missed one, so ask for a full resync.
    const applyPatch = (patch) => {
      if (!patch || patch.version <= stateVersionRef.current) return;
      if (patch.version !== stateVersionRef.current + 1) {
        requestResync(gameId);
        return;
      }
      stateVersionRef.current = patch.version;

      for (const change of patch.changes || []) {
        setPlayers((prev) =>
          prev.map((p) =>
            p.player_id === change.playerId
              ? { ...p, current_score: change.newScore }
              : p
          )
        );
        setSelectedPlayer((prev) =>
          prev && prev.player_id === change.playerId
            ? { ...prev, current_score: change.newScore }
            : prev
        );
        if (change.entry) {
          setHistoryByPlayer((prev) => {
            const current = prev[change.playerId] || [];
            return {
              ...prev,
              [change.playerId]: [change.entry, ...current].slice(0, 5),
            };
          });
        }
      }
    };

    // On (re)connect, our version baseline is stale — drop it and re-join so
    // the server sends a fresh full frame.
    const onOpen = () => {
      stateVersionRef.current = 0;
      joinGame(gameId);
    };

    const unsubFull = on('game:state', applyFull);
    const unsubPatch = on('game:patch', applyPatch);
    const unsubOpen = on('open', onOpen);
    const unsubError = on('error', (err) =>
      console.error('Socket error:', err?.message || err)
    );

    return () => {
      cancelled = true;
      unsubFull();
      unsubPatch();
      unsubOpen();
      unsubError();
      leaveGame(gameId);
    };
  }, [gameId]);

  const history = selectedPlayer
    ? (historyByPlayer[selectedPlayer.player_id] || []).slice(0, 5)
    : [];

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

    const playerId = selectedPlayer.player_id;
    const requestId = ++scoreRequestIdRef.current;

    // Optimistic: instant local feedback. The next `game:state` frame carries
    // the authoritative score + history entry.
    setPlayers((prev) => prev.map((player) =>
      player.player_id === playerId
        ? { ...player, current_score: Math.max(0, player.current_score + amount) }
        : player
    ));
    setSelectedPlayer((prev) => (
      prev && prev.player_id === playerId
        ? { ...prev, current_score: Math.max(0, prev.current_score + amount) }
        : prev
    ));

    const res = await emitScoreChange(gameId, playerId, amount);
    if (requestId !== scoreRequestIdRef.current) return;

    if (!res.ok) {
      console.error('Failed to update score:', res.error);
      try {
        await reconcileFromRest();
      } catch (error) {
        console.error('Failed to reconcile after score error:', error);
      }
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

    // Optimistic; the server broadcasts a `game:state` frame to the whole room.
    setGameData((prev) => (prev ? { ...prev, status: next } : prev));

    try {
      await updateGameStatus(gameId, next);
    } catch (error) {
      console.error('Failed to update game status:', error);
      alert(error.response?.data?.error || 'Failed to update the game');
      try {
        await reconcileFromRest();
      } catch (reconcileError) {
        console.error('Failed to reconcile game status:', reconcileError);
      }
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
