import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameAPI } from '../hooks/useGame';
import { useGame } from '../context/GameContext';
import { copyText } from '../lib/clipboard';
import {
  saveGameSnapshot,
  loadGameSnapshot,
  deleteGameSnapshot,
  enqueueOp,
} from '../lib/offlineSync';

// A game created while offline gets a client-side id until the deferred
// create syncs (see CreateGame.jsx / lib/offlineSync.js) — no server round
// trip is possible for it yet, so REST/WS are skipped entirely in favor of
// the locally-saved snapshot.
const isLocalGameId = (id) => id.startsWith('local-');

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
  const { joinGame, leaveGame, on, emitScoreChange, requestResync, isConnected } = useGame();
  const isLocalGame = isLocalGameId(gameId);
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

  // A game created offline lives only in localStorage until its deferred
  // `create-game` op syncs — no REST/WS for it yet.
  useEffect(() => {
    if (!isLocalGame) return;
    const snapshot = loadGameSnapshot(gameId);
    if (!snapshot) {
      navigate('/'); // nothing to show — nothing was ever saved under this id
      return;
    }
    setGameData(snapshot.game);
    setPlayers(snapshot.players);
    setHistoryByPlayer(snapshot.history || {});
    setLoading(false);
  }, [gameId, isLocalGame]);

  // Once this device's own deferred create syncs, swap the URL to the real
  // id — the next mount talks to the server like any other game.
  useEffect(() => {
    if (!isLocalGame) return;
    const onCreated = (e) => {
      const { localId, game } = e.detail || {};
      if (localId !== gameId) return;
      deleteGameSnapshot(gameId);
      navigate(`/game/${game.id}`, { replace: true });
    };
    window.addEventListener('offlinesync:gamecreated', onCreated);
    return () => window.removeEventListener('offlinesync:gamecreated', onCreated);
  }, [gameId, isLocalGame, navigate]);

  // Keep a local mirror of whatever's currently on screen — REST/WS state
  // for a synced game, optimistic local state for one that's not (yet). If
  // the connection drops mid-session, reloading the tab still shows this
  // instead of nothing.
  useEffect(() => {
    if (!gameData) return;
    saveGameSnapshot(gameId, { game: gameData, players, history: historyByPlayer });
  }, [gameId, gameData, players, historyByPlayer]);

  useEffect(() => {
    if (isLocalGame) return;
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
        // A network-level failure (no response at all) means we're offline,
        // not that the game doesn't exist — fall back to the last snapshot
        // rather than bouncing the user out.
        const snapshot = !error.response && loadGameSnapshot(gameId);
        if (cancelled) {
          // no-op
        } else if (snapshot) {
          setGameData(snapshot.game);
          setPlayers(snapshot.players);
          setHistoryByPlayer(snapshot.history || {});
        } else {
          navigate('/');
        }
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
  // Fixed 5-slot stack, oldest -> newest left to right, left-padded with
  // empties. A new entry shifts everything left; the oldest falls off.
  const historySlots = [
    ...Array(Math.max(0, 5 - history.length)).fill(null),
    ...[...history].reverse(),
  ];

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
    const newScore = Math.max(0, selectedPlayer.current_score + amount);

    // Optimistic: instant local feedback. The next `game:state` frame carries
    // the authoritative score + history entry.
    setPlayers((prev) => prev.map((player) =>
      player.player_id === playerId ? { ...player, current_score: newScore } : player
    ));
    setSelectedPlayer((prev) => (
      prev && prev.player_id === playerId ? { ...prev, current_score: newScore } : prev
    ));

    // No connection (or this game hasn't synced at all yet): don't wait on a
    // WS round trip that can only time out. Queue it — synthesize the same
    // shape a `game:patch` entry would carry so "Recent entries" isn't blank
    // until it syncs — and replay it once we're back online (see
    // GameContext's flushQueue trigger).
    if (isLocalGame || !isConnected) {
      const opId = enqueueOp({
        type: 'score-change',
        payload: { gameId, playerId, changeAmount: amount },
      });
      const entry = {
        id: opId,
        change_amount: amount,
        new_score: newScore,
        timestamp: new Date().toISOString().replace('T', ' ').replace('Z', ''),
      };
      setHistoryByPlayer((prev) => ({
        ...prev,
        [playerId]: [entry, ...(prev[playerId] || [])].slice(0, 5),
      }));
      return;
    }

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
              <span className="font-semibold">
                Code: {gameData?.code || 'pending — syncing…'}
              </span>
              {gameData?.code && (
                <button
                  onClick={() => copyText(gameData?.code)}
                  className="font-semibold text-primary hover:text-primary-dark"
                >
                  Copy
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Offline banner — score changes still work, just queued locally */}
      {!isConnected && (
        <div className="px-6 py-2 text-center text-xs font-semibold bg-blue-50 text-blue-700">
          📡 Offline — changes are saved on this device and will sync once
          you're back online.
        </div>
      )}

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

            {/* Recent entries — a left-to-right stack of the last 5 changes.
                Newest sits on the right; a new one pushes the oldest off the left. */}
            {history.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-gray-600 mb-2">
                  Recent entries
                </p>
                <div className="flex gap-1.5">
                  {historySlots.map((entry, i) => (
                    <div
                      key={i}
                      className={`flex-1 min-h-[3rem] flex flex-col items-center justify-center rounded-lg border px-1 py-2 text-center transition-colors ${
                        !entry
                          ? 'border-dashed border-gray-200 bg-gray-50'
                          : entry.change_amount >= 0
                          ? 'border-green-200 bg-green-50'
                          : 'border-red-200 bg-red-50'
                      }`}
                    >
                      {entry ? (
                        <>
                          <span
                            className={`text-base font-bold leading-none ${
                              entry.change_amount >= 0
                                ? 'text-green-700'
                                : 'text-red-700'
                            }`}
                          >
                            {entry.change_amount >= 0 ? '+' : ''}
                            {entry.change_amount}
                          </span>
                          <span className="mt-1 text-[10px] leading-none text-gray-400">
                            {formatEntryTime(entry.timestamp)}
                          </span>
                        </>
                      ) : (
                        <span className="text-base font-bold leading-none text-gray-300">
                          –
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  <span>Previous</span>
                  <span>Latest</span>
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
