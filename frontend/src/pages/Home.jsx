import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useGame';

export const Home = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A stored sessionToken may predate passwords entirely (a legacy account).
  // Verify it against /auth/me rather than trusting localStorage blindly, so
  // we know whether to offer that account a "set a password" prompt.
  const [checkingSession, setCheckingSession] = useState(true);
  const [profile, setProfile] = useState(null);
  const [claimPassword, setClaimPassword] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!localStorage.getItem('sessionToken')) {
      setCheckingSession(false);
      return undefined;
    }
    api
      .get('/auth/me')
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        // The 401 response interceptor already clears storage on failure;
        // nothing else to do here.
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async () => {
    if (!username.trim() || !password) return;

    try {
      setLoading(true);
      setError('');
      const { data } = await api.post(mode === 'login' ? '/auth/login' : '/users', {
        username: username.trim(),
        password,
      });

      localStorage.setItem('username', data.display_name || username.trim());
      localStorage.setItem('userId', data.id);
      localStorage.setItem('sessionToken', data.sessionToken);
      window.location.reload();
    } catch (err) {
      setError(
        err.response?.data?.error || `Failed to ${mode === 'login' ? 'log in' : 'register'}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    if (claimPassword.length < 8) {
      setClaimError('Password must be at least 8 characters');
      return;
    }
    try {
      setClaiming(true);
      setClaimError('');
      await api.post('/auth/claim', { password: claimPassword });
      setClaimed(true);
    } catch (err) {
      setClaimError(err.response?.data?.error || 'Failed to set password');
    } finally {
      setClaiming(false);
    }
  };

  const storedUsername = localStorage.getItem('username');

  // Avoid a login-form flash while the stored token is still being verified.
  if (checkingSession) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  if (!storedUsername) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pb-24">
        <div className="card max-w-md w-full">
          <h1 className="text-2xl font-bold mb-2">
            {mode === 'login' ? 'Welcome back' : 'Welcome to Scorekeeper'}
          </h1>
          <p className="text-gray-600 mb-6">
            {mode === 'login' ? 'Log in to your account' : 'Create an account to get started'}
          </p>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field mb-3"
            disabled={loading}
            autoComplete="username"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
            className="input-field mb-2"
            disabled={loading}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <button onClick={handleSubmit} disabled={loading} className="btn-primary w-full mb-4">
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
            }}
            className="text-sm text-gray-600 hover:text-gray-900 w-full text-center"
          >
            {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
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

      {profile && !profile.hasPassword && !claimed && (
        <div className="px-6 pt-6 max-w-2xl mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 rounded-3xl p-6">
            <h3 className="font-bold mb-1">Set a password</h3>
            <p className="text-gray-600 text-sm mb-4">
              Your account doesn't have a password yet — set one so you can log back in from
              another device.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="New password"
                value={claimPassword}
                onChange={(e) => setClaimPassword(e.target.value)}
                className="input-field flex-1"
                disabled={claiming}
                autoComplete="new-password"
              />
              <button onClick={handleClaim} disabled={claiming} className="btn-primary px-5">
                {claiming ? '...' : 'Set'}
              </button>
            </div>
            {claimError && <p className="text-red-600 text-sm mt-2">{claimError}</p>}
          </div>
        </div>
      )}

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
