import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useGame';
import { useGame } from '../context/GameContext';
import { AuthForm } from '../components/AuthForm';

export const Home = () => {
  const navigate = useNavigate();
  const { isConnected } = useGame();
  const [guestName, setGuestName] = useState('');
  const [guestError, setGuestError] = useState('');
  // Set when a guest (see handleContinueAsGuest) asks to log in and sync —
  // shows the auth form on top of an existing guest session instead of the
  // normal signed-in home screen.
  const [showAuthForm, setShowAuthForm] = useState(false);

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

  // No account, no network to make one with: play entirely locally under a
  // client-side id (see CreateGame.jsx's offline path) until this device is
  // both online and logged in.
  const handleContinueAsGuest = () => {
    const trimmed = guestName.trim();
    if (trimmed.length < 2) {
      setGuestError('Name must be at least 2 characters');
      return;
    }
    localStorage.setItem('username', trimmed);
    localStorage.setItem('userId', `local-user-${crypto.randomUUID()}`);
    localStorage.setItem('guestMode', 'true');
    window.location.reload();
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
  const guestMode = localStorage.getItem('guestMode') === 'true';
  const isSyncPrompt = Boolean(storedUsername) && showAuthForm;

  // Avoid a login-form flash while the stored token is still being verified.
  if (checkingSession) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  if (!storedUsername || showAuthForm) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pb-24">
        <div className="card max-w-md w-full">
          <AuthForm
            title={isSyncPrompt ? 'Sync your game' : 'Welcome back'}
            subtitle={
              isSyncPrompt
                ? "Log in or create an account to save what you've played so far."
                : 'Log in to your account, or create one to get started.'
            }
            onCancel={isSyncPrompt ? () => setShowAuthForm(false) : undefined}
          />

          {!storedUsername && !isConnected && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-sm text-gray-600 mb-3">
                No connection yet? Play locally and sync once you're back online.
              </p>
              <input
                type="text"
                placeholder="Your name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleContinueAsGuest()}
                className="input-field mb-2"
              />
              {guestError && <p className="text-red-600 text-sm mb-2">{guestError}</p>}
              <button onClick={handleContinueAsGuest} className="btn-secondary w-full">
                Continue offline as guest
              </button>
            </div>
          )}
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

      {guestMode && isConnected && (
        <div className="px-6 pt-6 max-w-2xl mx-auto">
          <div className="bg-blue-50 border border-blue-200 rounded-3xl p-6 flex items-center justify-between gap-4">
            <p className="text-gray-700 text-sm">You're back online — log in to sync your game.</p>
            <button onClick={() => setShowAuthForm(true)} className="btn-primary shrink-0 px-4 py-2">
              Log in
            </button>
          </div>
        </div>
      )}

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

        {/* Join Game Card — needs a live code lookup, no offline path exists (see offlineSync.js) */}
        <div
          onClick={() => isConnected && navigate('/join')}
          aria-disabled={!isConnected}
          className={`rounded-3xl p-6 transition-all ${
            isConnected
              ? 'bg-gray-100 cursor-pointer hover:bg-gray-200'
              : 'bg-gray-50 cursor-not-allowed opacity-60'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg">Join Existing Scoreboard</h3>
              <p className="text-gray-600">
                {isConnected ? 'Enter a game code from your host.' : 'Needs a connection.'}
              </p>
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
