import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useGame';

// Simple UUID generator
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const Home = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetUsername = async () => {
    if (!username.trim()) return;

    try {
      setLoading(true);
      const userId = generateUUID();
      const sessionToken = 'token_' + userId;

      // Create user in backend (same origin; headers are explicit because
      // localStorage has no userId yet on first run)
      const response = await api.post(
        '/users',
        { username: username.trim() },
        {
          headers: {
            'x-user-id': userId,
            'x-session-token': sessionToken,
          },
        }
      );

      // Store credentials
      localStorage.setItem('username', username);
      localStorage.setItem('userId', response.data.id || userId);
      localStorage.setItem('sessionToken', sessionToken);
      window.location.reload();
    } catch (error) {
      console.error('Failed to create user:', error);
      alert('Failed to set username');
    } finally {
      setLoading(false);
    }
  };

  const storedUsername = localStorage.getItem('username');

  if (!storedUsername) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pb-24">
        <div className="card max-w-md w-full">
          <h1 className="text-2xl font-bold mb-2">Welcome to Scorekeeper</h1>
          <p className="text-gray-600 mb-6">Enter your name to get started</p>
          <input
            type="text"
            placeholder="Your name"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field mb-4"
            onKeyPress={(e) => e.key === 'Enter' && handleSetUsername()}
            disabled={loading}
          />
          <button
            onClick={handleSetUsername}
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Setting up...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-6 py-8 shadow-sm">
        <p className="text-sm text-gray-500 font-semibold tracking-wider">GAME NIGHT</p>
        <h1 className="text-4xl font-bold text-gray-900">Welcome back, {storedUsername}</h1>
        <p className="text-gray-600 mt-2">Keep every point counted.</p>
      </div>

      <div className="px-6 py-8 max-w-2xl mx-auto space-y-6">
        {/* Create Game Card */}
        <div
          onClick={() => navigate('/create')}
          className="bg-gradient-to-br from-primary to-primary-dark rounded-3xl p-8 text-white cursor-pointer hover:shadow-lg transition-all"
        >
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-3xl font-bold mb-2">Create New Scoreboard</h2>
              <p className="text-primary-light">
                Start a game, invite your friends, and keep the score moving.
              </p>
            </div>
            <div className="w-20 h-20 bg-white bg-opacity-10 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Join Game Card */}
        <div
          onClick={() => navigate('/join')}
          className="bg-gray-100 rounded-3xl p-6 cursor-pointer hover:bg-gray-200 transition-all"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg">Join Existing Scoreboard</h3>
              <p className="text-gray-600">Enter a game code from your host.</p>
            </div>
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
