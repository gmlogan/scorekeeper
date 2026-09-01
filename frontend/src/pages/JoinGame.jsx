import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameAPI } from '../hooks/useGame';

export const JoinGame = () => {
  const navigate = useNavigate();
  const { joinGame } = useGameAPI();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const username = localStorage.getItem('username');

  useEffect(() => {
    if (!username) {
      navigate('/');
    }
  }, [username, navigate]);

  const formatCode = (value) => {
    return value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  };

  const handleChange = (e) => {
    const formatted = formatCode(e.target.value);
    setCode(formatted);
    setError('');
  };

  const handleJoinGame = async () => {
    if (!code || code.length < 8) {
      setError('Please enter a valid game code');
      return;
    }

    try {
      setLoading(true);
      const result = await joinGame(code, username);
      navigate(`/game/${result.game.id}`);
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to join game');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8 flex flex-col">
      <button
        onClick={() => navigate('/')}
        className="mb-6 p-3 bg-gray-100 rounded-full inline-block w-fit"
      >
        ←
      </button>

      <div className="flex-1 flex items-center">
        <div className="max-w-md w-full mx-auto">
          <h1 className="text-4xl font-bold mb-2">Join Scoreboard</h1>
          <p className="text-gray-600 mb-8">FIND GAME</p>

          {/* Key Icon */}
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31.84 2.41 2 2.83V20c0 .55.45 1 1 1h1v-3h2v3h1c.55 0 1-.45 1-1v-.17c1.16-.42 2-1.52 2-2.83 0-1.66-1.34-3-3-3zm13.71-9.71L19 0h-8v2h5.59L4 16.59V10H2v8c0 1.1.9 2 2 2h8v-2H4v-2.59L17.59 2H12V0h8v8h2V2.71c0-.39-.16-.74-.39-.97z" />
              </svg>
            </div>
          </div>

          {/* Code Input */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-2">Enter Room Code</h2>
            <p className="text-gray-600 mb-6">
              Enter the code provided by the game host to join the live scoreboard.
            </p>
            <input
              type="text"
              placeholder="E.G. CAT-7892"
              value={code}
              onChange={handleChange}
              maxLength="8"
              className={`input-field text-center text-2xl tracking-widest font-mono ${
                error ? 'border-red-500 focus:ring-red-500' : ''
              }`}
            />
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          </div>

          {/* Join Button */}
          <button
            onClick={handleJoinGame}
            disabled={loading || !code}
            className="btn-primary w-full mb-8"
          >
            {loading ? '⏳ Joining...' : '← Join Game'}
          </button>

          {/* Help */}
          <div className="text-center">
            <button className="text-gray-600 hover:text-gray-900 text-sm font-semibold flex items-center justify-center gap-2 mx-auto">
              <span>❓</span>
              Where can I find the code?
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
