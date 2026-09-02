import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameAPI } from '../hooks/useGame';
import { copyText } from '../lib/clipboard';

export const CreateGame = () => {
  const navigate = useNavigate();
  const { createGame } = useGameAPI();
  const [name, setName] = useState('');
  const [playerInput, setPlayerInput] = useState('');
  const [players, setPlayers] = useState([]);
  const [targetScore, setTargetScore] = useState('');
  const [timeLimit, setTimeLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const [gameCode, setGameCode] = useState('');
  const [gameId, setGameId] = useState('');

  const addPlayer = () => {
    if (playerInput.trim() && !players.includes(playerInput.trim())) {
      setPlayers([...players, playerInput.trim()]);
      setPlayerInput('');
    }
  };

  const removePlayer = (playerName) => {
    setPlayers(players.filter((p) => p !== playerName));
  };

  const handleCreateGame = async () => {
    if (!name.trim()) {
      alert('Please enter a game name');
      return;
    }

    try {
      setLoading(true);
      const result = await createGame(
        name,
        players,
        targetScore ? parseInt(targetScore) : null,
        timeLimit ? parseInt(timeLimit) : null
      );
      setGameCode(result.code);
      setGameId(result.id);
    } catch (error) {
      console.error('Failed to create game:', error);
      alert('Failed to create game');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    const ok = await copyText(gameCode);
    alert(ok ? 'Code copied to clipboard!' : `Copy failed — game code is ${gameCode}`);
  };

  const shareCode = () => {
    const text = `Join my game on Scorekeeper! Code: ${gameCode}`;
    if (navigator.share) {
      navigator.share({
        title: 'Scorekeeper Game',
        text: text,
      });
    } else {
      alert(text);
    }
  };

  if (gameCode) {
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-8 pb-24">
        <button
          onClick={() => navigate('/')}
          className="mb-6 p-3 bg-gray-100 rounded-full inline-block"
        >
          ←
        </button>

        <div className="max-w-md mx-auto">
          <h1 className="text-4xl font-bold mb-2">Create Scoreboard</h1>
          <p className="text-gray-600 mb-8">SETUP NEW GAME</p>

          <div className="card text-center">
            <p className="text-sm text-gray-500 mb-2">UNIQUE GAME CODE</p>
            <h2 className="text-5xl font-bold text-primary mb-6">{gameCode}</h2>
            <button
              onClick={copyCode}
              className="btn-secondary w-full mb-3"
            >
              📋 Copy Code
            </button>
            <button
              onClick={shareCode}
              className="btn-primary w-full"
            >
              📤 Share Code With Players
            </button>
          </div>

          <button
            onClick={() => navigate(`/game/${gameId}`)}
            className="btn-primary w-full mt-6"
          >
            🎮 Join Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8 pb-24">
      <button
        onClick={() => navigate('/')}
        className="mb-6 p-3 bg-gray-100 rounded-full inline-block"
      >
        ←
      </button>

      <div className="max-w-md mx-auto">
        <h1 className="text-4xl font-bold mb-2">Create Scoreboard</h1>
        <p className="text-gray-600 mb-8">SETUP NEW GAME</p>

        {/* Scoreboard Name */}
        <div className="mb-8">
          <label className="text-sm font-bold text-gray-600 mb-2 block">SCOREBOARD NAME</label>
          <input
            type="text"
            placeholder="Catan Championship"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
          />
        </div>

        {/* Players */}
        <div className="mb-8">
          <label className="text-sm font-bold text-gray-600 mb-2 block">PLAYERS</label>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              placeholder="Add player name..."
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addPlayer()}
              className="input-field flex-1"
            />
            <button
              onClick={addPlayer}
              className="bg-primary hover:bg-primary-dark text-white rounded-2xl w-12 h-12 flex items-center justify-center font-bold text-xl"
            >
              +
            </button>
          </div>

          {/* Player chips */}
          <div className="flex flex-wrap gap-2">
            <div className="bg-gray-200 text-gray-900 px-3 py-2 rounded-full text-sm font-semibold">
              You
            </div>
            {players.map((player) => (
              <div
                key={player}
                className="bg-gray-200 text-gray-900 px-3 py-2 rounded-full text-sm font-semibold flex items-center gap-2"
              >
                {player}
                <button
                  onClick={() => removePlayer(player)}
                  className="font-bold hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Game Rules */}
        <div className="mb-8">
          <label className="text-sm font-bold text-gray-600 mb-4 block">OPTIONAL GAME RULES</label>
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Target Score</h3>
                <p className="text-sm text-gray-600">First to reach points wins</p>
              </div>
              <input
                type="number"
                value={targetScore}
                onChange={(e) => setTargetScore(e.target.value)}
                placeholder="10"
                className="w-20 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold">Time Limit</h3>
                <p className="text-sm text-gray-600">Round duration in minutes</p>
              </div>
              <input
                type="number"
                value={timeLimit}
                onChange={(e) => setTimeLimit(e.target.value)}
                placeholder="Off"
                className="w-20 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreateGame}
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? '⏳ Creating...' : '▶ Create Scoreboard'}
        </button>
      </div>
    </div>
  );
};
