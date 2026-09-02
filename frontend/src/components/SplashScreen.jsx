import { useEffect, useState } from 'react';
import { APP_VERSION } from '../version';

// Brief branded splash shown on cold load. Fades out and unmounts via onDone.
export const SplashScreen = ({ onDone }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), 1500);
    const done = setTimeout(() => onDone && onDone(), 2050);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-primary-light via-primary to-primary-dark text-white transition-opacity duration-500 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <img
        src="/icon.svg"
        alt=""
        width="112"
        height="112"
        className="w-28 h-28 rounded-3xl shadow-lg"
      />
      <h1 className="mt-6 text-4xl font-bold tracking-tight">Scorekeeper</h1>
      <p className="mt-2 text-sm text-white text-opacity-80">
        Keep Every Point Counted
      </p>

      <div className="absolute inset-x-0 bottom-8 text-center text-xs text-white text-opacity-75">
        <p>&copy; {new Date().getFullYear()} LogSoft</p>
        <p className="mt-1 font-semibold tracking-wider">{APP_VERSION}</p>
      </div>
    </div>
  );
};
