(() => {
  // ---------- Theme ----------
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  const themeToggle = document.getElementById('theme-toggle');
  themeToggle.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    themeToggle.textContent = isDark ? '🌙' : '☀️';
  });

  // ---------- State ----------
  const socket = io();
  let myUsername = localStorage.getItem('username') || '';
  let replyTo = null;
  let dmWith = null;

  // ---------- Elements ----------
  const messagesEl = document.getElementById('messages');
  const dmMessagesEl = document.getElementById('dm-messages');
  const inputEl = document.getElementById('input');
  const composerEl = document.getElementById('composer');
  const onlineUsersEl = document.getElementById('online-users');
  const onlineCountEl = document.getElementById('online-count');
  const myUsernameEl = document.getElementById('my-username');
  const typingEl = document.getElementById('typing-indicator');
  const replyPreviewEl = document.getElementById('reply-preview');
  const replyTextEl = document.getElementById('reply-text');
  const cancelReplyBtn = document.getElementById('cancel-reply');
  const emojiBtn = document.getElementById('emoji-btn');
  const emojiPicker = document.getElementById('emoji-picker');
  const fileBtn = document.getElementById('file-btn');
  const fileInput = document.getElementById('file-input');
  const editUsernameBtn = document.getElementById('edit-username');
  const sidebarEl = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const dmPanel = document.getElementById('dm-panel');
  const dmWithEl = document.getElementById('dm-with');
  const closeDmBtn = document.getElementById('close-dm');
  const dmComposer = document.getElementById('dm-composer');
  const dmInput = document.getElementById('dm-input');

  // ---------- Username ----------
  function askUsername() {
    const name = prompt(
      'Choose a username (3–20 letters, numbers, or underscores):',
      myUsername || ''
    );
    if (name === null) return myUsername || 'User' + Math.floor(Math.random() * 1000);
    return name;
  }

  socket.on('connect', () => {
    if (!myUsername) myUsername = askUsername();
    socket.emit('join', myUsername);
  });

  socket.on('usernameAssigned', (name) => {
    myUsername = name;
    localStorage.setItem('username', name);
    myUsernameEl.textContent = name;
  });

  socket.on('usernameError', (msg) => alert(msg));

  editUsernameBtn.addEventListener('click', () => {
    const newName = prompt('Enter new username:', myUsername);
    if (newName && newName.trim() && newName.trim() !== myUsername) {
      socket.emit('updateUsername', newName.trim());
    }
  });

  // ---------- Helpers ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkifyMentions(escaped) {
    return escaped.replace(/(^|\s)@([a-zA-Z0-9_]{3,20})/g, (m, pre, name) => {
      return `${pre}<span class="mention">@${name}</span>`;
    });
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  function buildMessageEl(msg, options = {}) {
    const { isDM = false } = options;
    const isOwn = isDM ? msg.from === myUsername : msg.username === myUsername;
    const author = isDM ? msg.from : msg.username;

    const wrapper = document.createElement('div');
    wrapper.className = 'message' + (isOwn ? ' own' : '');
    wrapper.dataset.id = msg.id;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${author} · ${formatTime(msg.timestamp)}`;
    wrapper.appendChild(meta);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (msg.replyTo) {
      const quote = document.createElement('div');
      quote.className = 'reply-quote';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = msg.replyTo.username || 'unknown';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = (msg.replyTo.text || '').slice(0, 120);
      quote.appendChild(who);
      quote.appendChild(txt);
      bubble.appendChild(quote);
    }

    if (msg.fileData) {
      if (msg.fileType && msg.fileType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = msg.fileData;
        img.alt = msg.fileName || 'image';
        bubble.appendChild(img);
      } else {
        const a = document.createElement('a');
        a.className = 'file-link';
        a.href = msg.fileData;
        a.download = msg.fileName || 'file';
        a.textContent = '📎 ' + (msg.fileName || 'download');
        bubble.appendChild(a);
      }
    } else {
      bubble.innerHTML = linkifyMentions(escapeHtml(msg.message));
    }

    wrapper.appendChild(bubble);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const replyBtn = document.createElement('button');
    replyBtn.textContent = 'Reply';
    replyBtn.onclick = () => {
      replyTo = { username: author, text: msg.message || msg.fileName || '[file]', id: msg.id };
      replyTextEl.textContent = `Replying to ${author}: ${replyTo.text.slice(0, 80)}`;
      replyPreviewEl.classList.remove('hidden');
      inputEl.focus();
    };
    actions.appendChild(replyBtn);

    REACTION_EMOJIS.forEach(emoji => {
      const b = document.createElement('button');
      b.textContent = emoji;
      b.onclick = () => socket.emit('addReaction', { messageId: msg.id, emoji });
      actions.appendChild(b);
    });

    wrapper.appendChild(actions);

    const reactionsEl = document.createElement('div');
    reactionsEl.className = 'reactions';
    reactionsEl.dataset.forId = msg.id;
    wrapper.appendChild(reactionsEl);

    return wrapper;
  }

  function appendMessage(container, msg, options) {
    const placeholder = container.querySelector('.placeholder');
    if (placeholder) placeholder.remove();
    const el = buildMessageEl(msg, options);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  function updateReactions(messageId, counts) {
    const el = document.querySelector(`.reactions[data-for-id="${CSS.escape(String(messageId))}"]`);
    if (!el) return;
    el.innerHTML = '';
    Object.entries(counts).forEach(([emoji, count]) => {
      const chip = document.createElement('span');
      chip.className = 'reaction-chip';
      chip.textContent = `${emoji} ${count}`;
      el.appendChild(chip);
    });
  }

  // ---------- Socket events ----------
  socket.on('chatHistory', (rows) => {
    messagesEl.innerHTML = '';
    if (!rows.length) {
      const p = document.createElement('div');
      p.className = 'system-message placeholder';
      p.textContent = 'No messages yet. Say hi!';
      messagesEl.appendChild(p);
      return;
    }
    rows.forEach(r => appendMessage(messagesEl, r));
  });

  socket.on('chatMessage', (msg) => appendMessage(messagesEl, msg));
  socket.on('fileMessage', (msg) => appendMessage(messagesEl, msg));

  socket.on('systemMessage', (text) => {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  socket.on('messageDeleted', ({ id }) => {
    const el = messagesEl.querySelector(`.message[data-id="${CSS.escape(String(id))}"]`);
    if (el) el.remove();
  });

  socket.on('reactionUpdate', ({ messageId, counts }) => updateReactions(messageId, counts));

  socket.on('onlineUsers', (users) => {
    onlineCountEl.textContent = users.length;
    onlineUsersEl.innerHTML = '';
    users.forEach(name => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      li.appendChild(dot);
      const span = document.createElement('span');
      span.textContent = name;
      li.appendChild(span);
      if (name === myUsername) {
        li.classList.add('self');
        li.title = 'This is you';
      } else {
        li.title = `Send a private message to ${name}`;
        li.onclick = () => openDM(name);
      }
      onlineUsersEl.appendChild(li);
    });
  });

  socket.on('typingUsers', (users) => {
    const others = users.filter(u => u !== myUsername);
    typingEl.textContent = others.length
      ? `${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} typing…`
      : '';
  });

  // ---------- Send main message ----------
  composerEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    socket.emit('chatMessage', { message: text, replyTo });
    inputEl.value = '';
    clearReply();
    socket.emit('typing', false);
  });

  let typingTimer = null;
  inputEl.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit('typing', false), 1500);
  });

  // ---------- Reply ----------
  function clearReply() {
    replyTo = null;
    replyPreviewEl.classList.add('hidden');
    replyTextEl.textContent = '';
  }
  cancelReplyBtn.addEventListener('click', clearReply);

  // ---------- Emoji picker ----------
  const EMOJIS = ['😀','😂','😍','🥳','😎','🤔','😢','😡','👍','👎','❤️','🔥','🎉','✨','🙏','👋','💯','🚀','🍕','☕','🐱','🌈','⚡','💡'];
  EMOJIS.forEach(e => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.onclick = () => { inputEl.value += e; inputEl.focus(); };
    emojiPicker.appendChild(b);
  });
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.classList.add('hidden');
    }
  });

  // ---------- File upload ----------
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return alert('File too large. Max 4MB.');
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('fileMessage', {
        fileData: reader.result,
        fileName: file.name,
        fileType: file.type
      });
    };
    reader.readAsDataURL(file);
  });

  // ---------- DM ----------
  function openDM(username) {
    dmWith = username;
    dmWithEl.textContent = username;
    dmPanel.classList.remove('hidden');
    dmMessagesEl.innerHTML = '';
    socket.emit('getDMHistory', { withUser: username });
    if (window.innerWidth <= 860) sidebarEl.classList.remove('open');
  }

  closeDmBtn.addEventListener('click', () => {
    dmPanel.classList.add('hidden');
    dmWith = null;
  });

  dmComposer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = dmInput.value.trim();
    if (!text || !dmWith) return;
    socket.emit('privateMessage', { to: dmWith, message: text });
    dmInput.value = '';
  });

  socket.on('privateMessage', (msg) => {
    const other = msg.from === myUsername ? msg.to : msg.from;
    if (dmWith && other === dmWith) {
      appendMessage(dmMessagesEl, msg, { isDM: true });
    } else {
      const el = document.createElement('div');
      el.className = 'system-message';
      el.textContent = `New DM from ${msg.from} — click them in the sidebar to view.`;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  socket.on('dmHistory', ({ withUser, messages }) => {
    if (withUser !== dmWith) return;
    dmMessagesEl.innerHTML = '';
    if (!messages.length) {
      const p = document.createElement('div');
      p.className = 'system-message placeholder';
      p.textContent = `No messages with ${withUser} yet.`;
      dmMessagesEl.appendChild(p);
      return;
    }
    messages.forEach(m => appendMessage(dmMessagesEl, m, { isDM: true }));
  });

  // ---------- Sidebar toggle (mobile) ----------
  sidebarToggle.addEventListener('click', () => sidebarEl.classList.toggle('open'));

  socket.on('disconnect', () => { typingEl.textContent = ''; });
})();
