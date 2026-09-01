import { useLocation, useNavigate } from 'react-router-dom';

export const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path) => location.pathname === path;
  const settingsOpen =
    location.pathname === '/games' && new URLSearchParams(location.search).get('settings') === 'open';

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-4">
      <div className="max-w-2xl mx-auto flex justify-around items-center">
        <button
          onClick={() => navigate('/')}
          className={`flex flex-col items-center gap-2 py-2 px-4 rounded-xl transition-all ${
            isActive('/')
              ? 'text-primary'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
          </svg>
          <span className="text-xs font-semibold">HOME</span>
        </button>

        <button
          onClick={() => navigate('/games')}
          className={`flex flex-col items-center gap-2 py-2 px-4 rounded-xl transition-all ${
            isActive('/games') && !settingsOpen
              ? 'text-primary'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2z" />
          </svg>
          <span className="text-xs font-semibold">ACTIVE GAMES</span>
        </button>

        <button
          onClick={() => navigate('/games?settings=open')}
          className={`flex flex-col items-center gap-2 py-2 px-4 rounded-xl transition-all ${
            settingsOpen
              ? 'text-primary'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l1.72-1.34c.15-.12.19-.34.1-.51l-1.63-2.82c-.12-.22-.37-.29-.59-.22l-2.03.81c-.42-.32-.9-.6-1.44-.78L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35C8.7 5.53 8.23 5.81 7.81 6.13L5.78 5.32c-.22-.09-.47-.02-.59.22L2.56 8.36c-.1.17-.06.39.1.51l1.72 1.34c-.05.3-.07.62-.07.94s.02.64.07.94L2.66 14.28c-.15.12-.19.34-.1.51l1.63 2.82c.12.22.37.29.59.22l2.03-.81c.42.32.9.6 1.44.78l.3 2.15c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.3-2.15c.54-.18 1.02-.46 1.44-.78l2.03.81c.22.09.47.02.59-.22l1.63-2.82c.1-.17.06-.39-.1-.51l-1.72-1.34zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
          <span className="text-xs font-semibold">SETTINGS</span>
        </button>
      </div>
    </nav>
  );
};
