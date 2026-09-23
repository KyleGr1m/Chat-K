const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 6 * 1024 * 1024 // 6MB (for base64 file uploads)
});

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'AdminK';
const ADMIN_PASS = process.env.ADMIN_PASS || '272504d3kings';

// ---------- Database (schema unchanged) ----------
const db = new sqlite3.Database(path.join(__dirname, 'chat.db'));
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )
`);

function saveMessage(username, message, cb) {
  const ts = Date.now();
  db.run(
    'INSERT INTO messages (username, message, timestamp) VALUES (?, ?, ?)',
    [username, message, ts],
    function (err) {
      if (err) return cb(err);
      cb(null, { id: this.lastID, username, message, timestamp: ts });
    }
  );
}

function getRecentMessages(limit, cb) {
  db.all(
    'SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?',
    [limit],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows.reverse());
    }
  );
}

// ---------- In-memory state (no DB needed) ----------
const onlineUsers = new Map();   // socket.id -> username
const typingTimers = new Map();  // socket.id -> timeout
const typingUsers = new Map();   // socket.id -> username
const dmHistory = new Map();     // "a|b" -> [messages]
const reactions = new Map();     // messageId -> { emoji: count }

const adminSessions = new Set();

// ---------- Helpers ----------
function dmKey(a, b) {
  return [a, b].sort().join('|');
}

function findSocketIdByUsername(username) {
  for (const [id, name] of onlineUsers.entries()) {
    if (name === username) return id;
  }
  return null;
}

function broadcastOnlineUsers() {
  io.emit('onlineUsers', Array.from(onlineUsers.values()));
}

function broadcastTyping() {
  io.emit('typingUsers', Array.from(typingUsers.values()));
}

function isValidUsername(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(name);
}

function isUsernameTaken(name, exceptSocketId) {
  const lower = name.toLowerCase();
  for (const [id, user] of onlineUsers.entries()) {
    if (id !== exceptSocketId && user.toLowerCase() === lower) return true;
  }
  return false;
}

// ---------- Express ----------
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    adminSessions.add(token);
    return res.json({ ok: true, token });
  }
  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.get('/api/admin/messages', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!adminSessions.has(token)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  getRecentMessages(200, (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    res.json({ ok: true, messages: rows });
  });
});

app.delete('/api/admin/messages/:id', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!adminSessions.has(token)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const id = parseInt(req.params.id, 10);
  db.run('DELETE FROM messages WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    io.emit('messageDeleted', { id });
    res.json({ ok: true });
  });
});

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  getRecentMessages(100, (err, rows) => {
    if (!err) socket.emit('chatHistory', rows);
  });

  // Join with chosen username
  socket.on('join', (requestedName) => {
    let username = typeof requestedName === 'string' ? requestedName.trim() : '';

    if (!isValidUsername(username) || isUsernameTaken(username, socket.id)) {
      let base = (username || 'User').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15) || 'User';
      let candidate = base;
      let n = 1;
      while (isUsernameTaken(candidate, socket.id)) {
        candidate = base + n;
        n++;
      }
      username = candidate.slice(0, 20);
    }

    onlineUsers.set(socket.id, username);
    socket.emit('usernameAssigned', username);
    broadcastOnlineUsers();
    io.emit('systemMessage', `${username} joined the chat`);
  });

  // Rename
  socket.on('updateUsername', (newName) => {
    const oldName = onlineUsers.get(socket.id);
    if (!oldName) return;

    const trimmed = typeof newName === 'string' ? newName.trim() : '';
    if (!isValidUsername(trimmed)) {
      return socket.emit('usernameError', 'Use 3–20 letters, numbers, or underscores.');
    }
    if (isUsernameTaken(trimmed, socket.id)) {
      return socket.emit('usernameError', 'That username is already taken.');
    }
    if (trimmed === oldName) return;

    onlineUsers.set(socket.id, trimmed);
    socket.emit('usernameAssigned', trimmed);
    broadcastOnlineUsers();
    io.emit('systemMessage', `${oldName} is now ${trimmed}`);
  });

  // Public room message
  socket.on('chatMessage', (payload) => {
    const username = onlineUsers.get(socket.id);
    if (!username) return;

    const text = typeof payload === 'string' ? payload : (payload && payload.message);
    const replyTo = payload && payload.replyTo ? payload.replyTo : null;

    if (typeof text !== 'string' || !text.trim()) return;
    const message = text.trim().slice(0, 2000);

    saveMessage(username, message, (err, saved) => {
      if (err) return;
      io.emit('chatMessage', { ...saved, replyTo });
    });
  });

  // Typing
  socket.on('typing', (isTyping) => {
    const username = onlineUsers.get(socket.id);
    if (!username) return;

    if (isTyping) {
      typingUsers.set(socket.id, username);
      clearTimeout(typingTimers.get(socket.id));
      const t = setTimeout(() => {
        typingUsers.delete(socket.id);
        typingTimers.delete(socket.id);
        broadcastTyping();
      }, 2500);
      typingTimers.set(socket.id, t);
    } else {
      typingUsers.delete(socket.id);
      clearTimeout(typingTimers.get(socket.id));
      typingTimers.delete(socket.id);
    }
    broadcastTyping();
  });

  // Private message
  socket.on('privateMessage', ({ to, message, replyTo }) => {
    const from = onlineUsers.get(socket.id);
    if (!from || !to || typeof message !== 'string') return;

    const text = message.trim().slice(0, 2000);
    if (!text) return;

    const msg = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      from,
      to,
      message: text,
      timestamp: Date.now(),
      replyTo: replyTo || null
    };

    const key = dmKey(from, to);
    if (!dmHistory.has(key)) dmHistory.set(key, []);
    dmHistory.get(key).push(msg);

    const toId = findSocketIdByUsername(to);
    const fromId = findSocketIdByUsername(from);
    if (toId) io.to(toId).emit('privateMessage', msg);
    if (fromId && fromId !== toId) io.to(fromId).emit('privateMessage', msg);
  });

  socket.on('getDMHistory', ({ withUser }) => {
    const me = onlineUsers.get(socket.id);
    if (!me || !withUser) return;
    const key = dmKey(me, withUser);
    socket.emit('dmHistory', {
      withUser,
      messages: dmHistory.get(key) || []
    });
  });

  // Reactions
  socket.on('addReaction', ({ messageId, emoji }) => {
    const username = onlineUsers.get(socket.id);
    if (!username || !messageId || !emoji) return;

    if (!reactions.has(messageId)) reactions.set(messageId, {});
    const counts = reactions.get(messageId);
    counts[emoji] = (counts[emoji] || 0) + 1;
    io.emit('reactionUpdate', { messageId, counts });
  });

  // File / image (base64)
  socket.on('fileMessage', ({ fileData, fileName, fileType }) => {
    const username = onlineUsers.get(socket.id);
    if (!username) return;
    if (typeof fileData !== 'string' || !fileData.startsWith('data:')) return;

    io.emit('fileMessage', {
      id: 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      username,
      fileData,
      fileName: String(fileName || 'file').slice(0, 100),
      fileType: String(fileType || '').slice(0, 100),
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    typingUsers.delete(socket.id);
    clearTimeout(typingTimers.get(socket.id));
    typingTimers.delete(socket.id);
    broadcastOnlineUsers();
    broadcastTyping();
    if (username) io.emit('systemMessage', `${username} left the chat`);
  });
});

server.listen(PORT, () => {
  console.log(`Chat-Box running on port ${PORT}`);
});
