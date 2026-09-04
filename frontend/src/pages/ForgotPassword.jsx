import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../hooks/useGame';

export const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) return;
    try {
      setLoading(true);
      await api.post('/auth/forgot-password', { email: email.trim() });
    } finally {
      // Always show the same confirmation, whether or not the email is
      // registered — the backend responds identically either way.
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 pb-24">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2">Reset your password</h1>
        {sent ? (
          <>
            <p className="text-gray-600 mb-6">
              If that email has an account, we've sent a reset link to it.
            </p>
            <button onClick={() => navigate('/')} className="btn-primary w-full">
              Back to log in
            </button>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-6">Enter your email and we'll send you a reset link.</p>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
              className="input-field mb-4"
              disabled={loading}
              autoComplete="email"
            />
            <button onClick={handleSubmit} disabled={loading} className="btn-primary w-full mb-4">
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-sm text-gray-600 hover:text-gray-900 w-full text-center"
            >
              Back to log in
            </button>
          </>
        )}
      </div>
    </div>
  );
};
