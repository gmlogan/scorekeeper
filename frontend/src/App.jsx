import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { GameProvider } from './context/GameContext';
import { Navigation } from './components/Navigation';
import { SplashScreen } from './components/SplashScreen';
import { Home } from './pages/Home';
import { CreateGame } from './pages/CreateGame';
import { JoinGame } from './pages/JoinGame';
import { GameBoard } from './pages/GameBoard';
import { ActiveGames } from './pages/ActiveGames';
import './index.css';

function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <GameProvider>
      <Router>
        <div className="min-h-screen bg-gray-50">
          {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/create" element={<CreateGame />} />
            <Route path="/join" element={<JoinGame />} />
            <Route path="/games" element={<ActiveGames />} />
            <Route path="/game/:gameId" element={<GameBoard />} />
            <Route path="*" element={<Home />} />
          </Routes>
          <Navigation />
        </div>
      </Router>
    </GameProvider>
  );
}

export default App;
