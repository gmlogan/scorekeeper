import axios from 'axios';

// Empty string => same-origin (production, served by the backend).
// In dev, .env.development points this at the local backend.
const API_URL = import.meta.env.VITE_API_URL ?? '';

// Create axios instance with default config
export const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Attach the server-issued bearer token to every request.
api.interceptors.request.use((config) => {
  const sessionToken = localStorage.getItem('sessionToken');
  if (sessionToken) config.headers['Authorization'] = `Bearer ${sessionToken}`;
  return config;
});

// A session token now regularly goes stale without this tab's doing it —
// logging in elsewhere rotates it, logging out clears it. Without this, a
// live tab holding the old token just throws a raw axios error from
// whatever it happened to be doing; bounce it to the login screen instead.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      try {
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
      } catch (_) {
        /* storage unavailable */
      }
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);
