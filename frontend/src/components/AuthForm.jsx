import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useGame';

// Mirrors backend/src/lib/password.js's passwordComplexityError — shown as
// inline help so a weak password is caught before submit, not only on a
// 400 after.
const PASSWORD_HINT = 'At least 8 characters, mixing letters, numbers, and special characters';
const isComplexPassword = (password) =>
  password.length >= 8 &&
  password.length <= 128 &&
  /[A-Za-z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

// Shared by Home.jsx (signed-out landing) and GameBoard.jsx (a guest — see
// Home.jsx's "Continue offline as guest" — syncing a locally-created game
// once back online). Deliberately does a hard `location.reload()` on
// success rather than navigating anywhere: staying on whatever URL is
// already in the address bar is what lets GameBoard's own
// `offlinesync:gamecreated` listener catch the resulting reconnect-
// triggered flush and swap to the real game id.
export const AuthForm = ({ title, subtitle, onCancel }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email.trim() || !password) return;

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (!isComplexPassword(password)) {
        setError(PASSWORD_HINT);
        return;
      }
    }

    try {
      setLoading(true);
      setError('');
      const { data } = await api.post(mode === 'login' ? '/auth/login' : '/users', {
        email: email.trim(),
        password,
      });

      localStorage.setItem('username', data.display_name || email.trim());
      localStorage.setItem('userId', data.id);
      localStorage.setItem('sessionToken', data.sessionToken);
      localStorage.removeItem('guestMode');
      window.location.reload();
    } catch (err) {
      setError(
        err.response?.data?.error || `Failed to ${mode === 'login' ? 'log in' : 'register'}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-gray-600 mb-6">{subtitle}</p>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="input-field mb-3"
        disabled={loading}
        autoComplete="email"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && mode === 'login' && handleSubmit()}
        className="input-field mb-2"
        disabled={loading}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {mode === 'register' && (
        <>
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
            className="input-field mb-2"
            disabled={loading}
            autoComplete="new-password"
          />
          <p className="text-gray-500 text-xs mb-2">{PASSWORD_HINT}</p>
        </>
      )}
      {mode === 'login' && (
        <button
          onClick={() => navigate('/forgot-password')}
          className="text-sm text-gray-600 hover:text-gray-900 block mb-4"
        >
          Forgot password?
        </button>
      )}
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
      {onCancel && (
        <button
          onClick={onCancel}
          className="text-sm text-gray-500 hover:text-gray-700 w-full text-center mt-3"
        >
          Not now — keep playing offline
        </button>
      )}
    </>
  );
};
