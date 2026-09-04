import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGameAPI, api } from '../hooks/useGame';

const formatDate = (value) => {
  if (!value) return '';
  // SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS"
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const statusStyles = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  finished: 'bg-gray-200 text-gray-600',
};

export const ActiveGames = () => {
  const navigate = useNavigate();
  const { getHostedGames, deleteHostedGames, updateDisplayName } = useGameAPI();
  const [searchParams, setSearchParams] = useSearchParams();

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(
    searchParams.get('settings') === 'open'
  );
  const [displayName, setDisplayName] = useState(
    localStorage.getItem('username') || ''
  );
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [profileEmail, setProfileEmail] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const loadGames = async () => {
    try {
      setLoading(true);
      const data = await getHostedGames();
      setGames(data);
    } catch (error) {
      console.error('Failed to load games:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGames();
  }, []);

  useEffect(() => {
    setShowSettings(searchParams.get('settings') === 'open');
  }, [searchParams]);

  useEffect(() => {
    if (!showSettings || profileEmail) return;
    api
      .get('/auth/me')
      .then(({ data }) => setProfileEmail(data.email))
      .catch(() => {});
  }, [showSettings, profileEmail]);

  const closeSettings = () => {
    setShowSettings(false);
    if (searchParams.get('settings')) {
      searchParams.delete('settings');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const handleSaveName = async () => {
    const next = displayName.trim();
    if (next.length < 2) {
      alert('Display name must be at least 2 characters');
      return;
    }
    try {
      setSavingName(true);
      const user = await updateDisplayName(next);
      localStorage.setItem('username', user.display_name || next);
      closeSettings();
      window.location.reload();
    } catch (error) {
      console.error('Failed to update display name:', error);
      alert('Failed to update display name');
    } finally {
      setSavingName(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profileEmail) return;
    try {
      setResettingPassword(true);
      // Reuses the same public forgot-password endpoint the login screen
      // uses — no separate authed "change password" code path needed.
      await api.post('/auth/forgot-password', { email: profileEmail });
      setResetSent(true);
    } catch (error) {
      console.error('Failed to request password reset:', error);
      alert('Failed to send reset email');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout request failed:', error);
      // Clear locally regardless — the point is this browser stops acting
      // as this user even if the server call itself didn't land.
    } finally {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('userId');
      localStorage.removeItem('username');
      window.location.href = '/';
    }
  };

  const handleDeleteAll = async () => {
    if (
      !window.confirm(
        'Delete ALL scoreboards you created? Their scores and history go too. This cannot be undone.'
      )
    ) {
      return;
    }
    try {
      setDeleting(true);
      await deleteHostedGames();
      setGames([]);
      closeSettings();
      alert('All your scoreboards were deleted');
    } catch (error) {
      console.error('Failed to delete games:', error);
      alert('Failed to delete scoreboards');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white px-6 py-8 shadow-sm flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500 font-semibold tracking-wider">
            YOUR SCOREBOARDS
          </p>
          <h1 className="text-4xl font-bold text-gray-900">Active Games</h1>
          <p className="text-gray-600 mt-2">Everything you've created, newest first.</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          aria-label="Profile settings"
          className="shrink-0 p-3 bg-gray-100 rounded-full hover:bg-gray-200 transition-all"
        >
          <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l1.72-1.34c.15-.12.19-.34.1-.51l-1.63-2.82c-.12-.22-.37-.29-.59-.22l-2.03.81c-.42-.32-.9-.6-1.44-.78L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.7 5.53 8.23 5.81 7.81 6.13L5.78 5.32c-.22-.09-.47-.02-.59.22L2.56 8.36c-.1.17-.06.39.1.51l1.72 1.34c-.05.3-.07.62-.07.94s.02.64.07.94L2.66 14.28c-.15.12-.19.34-.1.51l1.63 2.82c.12.22.37.29.59.22l2.03-.81c.42.32.9.6 1.44.78l.3 2.15c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.3-2.15c.54-.18 1.02-.46 1.44-.78l2.03.81c.22.09.47.02.59-.22l1.63-2.82c.1-.17.06-.39-.1-.51l-1.72-1.34zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      </div>

      <div className="px-6 py-8 max-w-2xl mx-auto space-y-4">
        {loading ? (
          <p className="text-gray-500">Loading your scoreboards...</p>
        ) : games.length === 0 ? (
          <div className="bg-gray-100 rounded-3xl p-8 text-center">
            <p className="text-gray-600 mb-4">
              You haven't created any scoreboards yet.
            </p>
            <button onClick={() => navigate('/create')} className="btn-primary">
              Create New Scoreboard
            </button>
          </div>
        ) : (
          games.map((game) => (
            <div
              key={game.id}
              onClick={() => navigate(`/game/${game.id}`)}
              className="bg-white rounded-3xl p-6 cursor-pointer hover:shadow-lg transition-all flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-lg">{game.name}</h3>
                  <span
                    className={`text-xs font-semibold px-2 py-1 rounded-full ${
                      statusStyles[game.status] || statusStyles.finished
                    }`}
                  >
                    {game.status}
                  </span>
                </div>
                <p className="text-gray-600 text-sm mt-1">
                  Code {game.code} · {game.playerCount}{' '}
                  {game.playerCount === 1 ? 'player' : 'players'} ·{' '}
                  {formatDate(game.created_at)}
                </p>
              </div>
              <svg
                className="w-6 h-6 text-gray-400 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          ))
        )}
      </div>

      {/* Profile settings pop-up */}
      {showSettings && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 px-4"
          onClick={closeSettings}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-md w-full mb-24 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Profile Settings</h2>
              <button
                onClick={closeSettings}
                aria-label="Close"
                className="p-2 text-gray-400 hover:text-gray-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <label className="text-sm font-bold text-gray-600 mb-2 block">
              DISPLAY NAME
            </label>
            <div className="flex gap-2 mb-8">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSaveName()}
                className="input-field flex-1"
                placeholder="Your name"
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="btn-primary px-5"
              >
                {savingName ? '...' : 'Save'}
              </button>
            </div>

            <div className="border-t border-gray-200 pt-6 mb-6">
              <button
                onClick={handleResetPassword}
                disabled={resettingPassword || resetSent || !profileEmail}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-3 px-6 rounded-full transition-all disabled:opacity-50 mb-3"
              >
                {resetSent
                  ? 'Reset link sent — check your email'
                  : resettingPassword
                    ? 'Sending...'
                    : 'Reset password'}
              </button>
              <button
                onClick={handleLogout}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-3 px-6 rounded-full transition-all"
              >
                Log Out
              </button>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <h3 className="font-bold text-red-600 mb-1">Danger zone</h3>
              <p className="text-sm text-gray-600 mb-4">
                Permanently delete every scoreboard you've created, along with their
                scores and history.
              </p>
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-full transition-all disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete all my scoreboards'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
