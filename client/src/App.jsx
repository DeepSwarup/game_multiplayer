import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';

// const socket = io('http://localhost:3000', { 
//   autoConnect: true,
//   transports: ['websocket', 'polling'],
// });

const socket = io('https://game-multiplayer-alpha.vercel.app/', { 
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

const avatars = ['😊', '🚀', '🐱', '🌟', '🦁', '🎮', '👾', '🍕'];

function App() {
  const [players, setPlayers] = useState([]);
  const [myId, setMyId] = useState(null);
  const [winner, setWinner] = useState(null);
  const [username, setUsername] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(avatars[0]);
  const [gameState, setGameState] = useState({ walls: [], powerUp: null, penaltyZones: [], started: false });
  const [roomCode, setRoomCode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [joinCode, setJoinCode] = useState('');
  const [countdown, setCountdown] = useState(null);
  const chatRef = useRef(null);

  useEffect(() => {
    socket.on('connect', () => {
      setMyId(socket.id);
    });

    socket.on('roomCreated', ({ roomCode, maxPlayers }) => {
      setRoomCode(roomCode);
      setMaxPlayers(maxPlayers);
    });

    socket.on('joinedRoom', ({ roomCode, maxPlayers }) => {
      setRoomCode(roomCode);
      setMaxPlayers(maxPlayers);
    });

    socket.on('updatePlayers', (data) => {
      setPlayers(data.players);
      setGameState(data.gameState);
    });

    socket.on('playerJoined', (data) => {
      setPlayers((prev) => [...prev, { id: data.id, position: 5, speedBoost: false, penaltyTime: 0 }]);
    });

    socket.on('playerLeft', (data) => {
      setPlayers((prev) => prev.filter((p) => p.id !== data.id));
    });

    socket.on('gameOver', (data) => {
      setWinner(data);
    });

    socket.on('countdown', (time) => {
      setCountdown(time);
    });

    socket.on('countdownStopped', () => {
      setCountdown(null);
    });

    socket.on('gameStarted', () => {
      setCountdown(null);
    });

    socket.on('error', (msg) => {
      alert(msg);
    });

    socket.emit('getLeaderboard');
    socket.on('leaderboard', (data) => {
      setLeaderboard(data.leaderboard);
    });

    socket.on('newMessage', (message) => {
      setMessages((prev) => [...prev, message]);
      if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    });

    return () => {
      socket.off('connect');
      socket.off('roomCreated');
      socket.off('joinedRoom');
      socket.off('updatePlayers');
      socket.off('playerJoined');
      socket.off('playerLeft');
      socket.off('gameOver');
      socket.off('countdown');
      socket.off('countdownStopped');
      socket.off('gameStarted');
      socket.off('error');
      socket.off('leaderboard');
      socket.off('newMessage');
    };
  }, []);

  const handleCreateRoom = (e) => {
    e.preventDefault();
    socket.emit('createRoom', { maxPlayers: parseInt(maxPlayers) });
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    socket.emit('joinRoom', { roomCode: joinCode });
  };

  const handleUserInfoSubmit = (e) => {
    e.preventDefault();
    if (username.trim()) {
      socket.emit('setUserInfo', { username, avatar: selectedAvatar });
      setUsername('');
    }
  };

  const handleChatSubmit = (e) => {
    e.preventDefault();
    if (chatInput.trim()) {
      socket.emit('sendMessage', chatInput);
      setChatInput('');
    }
  };

  const handleMoveLeft = () => {
    if (!winner && gameState.started) socket.emit('moveLeft');
  };

  const handleMoveRight = () => {
    if (!winner && gameState.started) socket.emit('moveRight');
  };

  const handleReset = () => {
    socket.emit('resetGame');
    setWinner(null);
    socket.emit('getLeaderboard');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold text-blue-600 mb-4">Multiplayer Game</h1>
      {!roomCode ? (
        <div className="bg-white p-4 rounded shadow w-full max-w-md">
          <h2 className="text-xl font-semibold mb-4">Join or Create a Room</h2>
          <form onSubmit={handleCreateRoom} className="mb-4">
            <label className="block mb-2">Max Players:</label>
            <input
              type="number"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              min="2"
              max="10"
              className="border p-2 rounded w-full mb-2"
            />
            <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
              Create Room
            </button>
          </form>
          <form onSubmit={handleJoinRoom}>
            <label className="block mb-2">Room Code:</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter 4-digit code"
              className="border p-2 rounded w-full mb-2"
            />
            <button type="submit" className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">
              Join Room
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white p-4 rounded shadow w-full max-w-2xl flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4">
          <div className="flex-1">
            <h2 className="text-xl font-semibold mb-2">Room: {roomCode} (Players: {players.length}/{maxPlayers})</h2>
            <p className="text-gray-600 mb-2">Your ID: {myId || 'Connecting...'}</p>
            {countdown !== null && <p className="text-red-500 mb-2">Game starts in: {countdown}s</p>}

            <form onSubmit={handleUserInfoSubmit} className="mb-4">
              <div className="flex space-x-2 mb-2">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="flex-1 border p-2 rounded"
                />
                <select
                  value={selectedAvatar}
                  onChange={(e) => setSelectedAvatar(e.target.value)}
                  className="border p-2 rounded"
                >
                  {avatars.map((avatar) => (
                    <option key={avatar} value={avatar}>
                      {avatar}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                Set Info
              </button>
            </form>

            {winner && (
              <div className="mb-4 p-2 bg-yellow-100 text-yellow-800 rounded animate-fade-in">
                Game Over! Winner: {winner.winnerId === myId ? 'You!' : winner.username || winner.winnerId.slice(0, 8)}
              </div>
            )}

            <div className="text-gray-600 mb-4">
              <p>Walls: {gameState.walls.map(w => `${w.position} (${w.hits}/${w.maxHits})`).join(', ') || 'None'}</p>
              <p>Power-Up: {gameState.powerUp ? `Position ${gameState.powerUp.position}` : 'None'}</p>
              <p>Penalty Zones: {gameState.penaltyZones.join(', ')}</p>
            </div>

            <div className="space-y-4 mb-6">
              {players.map((player) => (
                <div key={player.id} className="flex flex-col">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">{player.avatar || '🤔'}</span>
                    <span
                      className={`text-sm ${player.id === myId ? 'font-bold text-blue-600' : 'text-gray-700'}`}
                    >
                      {player.username || player.id.slice(0, 8)}... {player.speedBoost ? '(Speed Boost)' : ''} {player.penaltyTime > 0 ? `(Penalty: ${player.penaltyTime}/3)` : ''}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <div className="grid grid-cols-11 gap-1 w-full">
                      {Array.from({ length: 11 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-6 border transition-all duration-300 ease-in-out ${
                            i === player.position
                              ? player.id === myId
                                ? 'bg-blue-500'
                                : 'bg-green-500'
                              : gameState.walls.some(w => w.position === i && w.hits < w.maxHits)
                              ? 'bg-red-500'
                              : gameState.powerUp && gameState.powerUp.position === i
                              ? 'bg-yellow-500'
                              : gameState.penaltyZones.includes(i)
                              ? 'bg-orange-500'
                              : 'bg-gray-200'
                          }`}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex space-x-4">
              <button
                onClick={handleMoveLeft}
                className={`px-4 py-2 rounded text-white ${winner || !gameState.started ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}
                disabled={!!winner || !gameState.started}
              >
                Move Left
              </button>
              <button
                onClick={handleMoveRight}
                className={`px-4 py-2 rounded text-white ${winner || !gameState.started ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}
                disabled={!!winner || !gameState.started}
              >
                Move Right
              </button>
              <button
                onClick={handleReset}
                className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
              >
                Reset Game
              </button>
            </div>
          </div>

          <div className="flex-1 flex flex-col">
            <h3 className="text-lg font-semibold mb-2">Chat</h3>
            <div
              ref={chatRef}
              className="flex-1 max-h-64 overflow-y-auto p-2 bg-gray-50 rounded border mb-2"
            >
              {messages.map((msg, index) => (
                <div key={index} className="text-sm text-gray-800 mb-1">
                  <span className="mr-1">{msg.avatar || '🤔'}</span>
                  <span className="font-semibold">{msg.username}:</span> {msg.message}
                </div>
              ))}
            </div>
            <form onSubmit={handleChatSubmit} className="flex">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message"
                className="flex-1 border p-2 rounded-l"
              />
              <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded-r hover:bg-blue-600">
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white p-4 rounded shadow w-full max-w-2xl mt-4 animate-fade-in">
        <h3 className="text-lg font-semibold mb-2">Leaderboard</h3>
        <ul>
          {leaderboard.map((entry, index) => (
            <li key={index} className="text-gray-700">
              {entry.username}: {entry.wins} wins
            </li>
          ))}
        </ul>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fadeIn 0.5s ease-in;
        }
      `}</style>
    </div>
  );
}

export default App;