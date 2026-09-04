import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../hooks/useGame';

// Mirrors backend/src/lib/password.js's passwordComplexityError.
const PASSWORD_HINT = 'At least 8 characters, mixing letters, numbers, and special characters';
const isComplexPassword = (password) =>
  password.length >= 8 &&
  password.length <= 128 &&
  /[A-Za-z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!isComplexPassword(password)) {
      setError(PASSWORD_HINT);
      return;
    }

    try {
      setLoading(true);
      setError('');
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pb-24">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2">Set a new password</h1>
        {done ? (
          <>
            <p className="text-gray-600 mb-6">Your password has been reset. Log in with it below.</p>
            <button onClick={() => navigate('/')} className="btn-primary w-full">
              Log in
            </button>
          </>
        ) : !token ? (
          <p className="text-red-600 text-sm">This reset link is missing its token.</p>
        ) : (
          <>
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field mb-2"
              disabled={loading}
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
              className="input-field mb-2"
              disabled={loading}
              autoComplete="new-password"
            />
            <p className="text-gray-500 text-xs mb-4">{PASSWORD_HINT}</p>
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button onClick={handleSubmit} disabled={loading} className="btn-primary w-full">
              {loading ? 'Saving...' : 'Reset password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
