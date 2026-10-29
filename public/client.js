'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

let state = null;
let currentCode = null;
let pendingWildCardId = null;

const COLOR_NAMES = { red: 'Qizil', yellow: 'Sariq', green: 'Yashil', blue: "Ko'k" };
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };

// ---------- Saqlash (sahifa yangilansa qayta ulanish uchun) ----------
const tokenKey = (code) => `uno:token:${code}`;
function saveSession(code, token) {
  localStorage.setItem(tokenKey(code), token);
  localStorage.setItem('uno:last', code);
}
function clearSession(code) {
  localStorage.removeItem(tokenKey(code));
  if (localStorage.getItem('uno:last') === code) localStorage.removeItem('uno:last');
  sessionStorage.removeItem(`uno:pw:${code}`);
}

// ---------- Ekranlar ----------
function show(screenId) {
  for (const id of ['home', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== screenId);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

function showError(elId, msg) {
  $(elId).textContent = msg || '';
  if (msg) setTimeout(() => { if ($(elId).textContent === msg) $(elId).textContent = ''; }, 4000);
}

// ---------- Bosh sahifa ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
});
function selectTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('createForm').classList.toggle('hidden', name !== 'create');
  $('joinForm').classList.toggle('hidden', name !== 'join');
}

const savedName = localStorage.getItem('uno:name') || '';
$('createForm').name.value = savedName;
$('joinForm').name.value = savedName;

$('createForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const name = f.name.value.trim();
  const password = f.password.value;
  localStorage.setItem('uno:name', name);
  socket.emit('createRoom', { name, password }, (res) => {
    if (!res.ok) return showError('homeError', res.error);
    sessionStorage.setItem(`uno:pw:${res.code}`, password);
    enterRoom(res.code, res.token);
  });
});

$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const code = f.code.value.trim().toUpperCase();
  const name = f.name.value.trim();
  localStorage.setItem('uno:name', name);
  socket.emit(
    'joinRoom',
    { code, name, password: f.password.value, token: localStorage.getItem(tokenKey(code)) },
    (res) => {
      if (!res.ok) return showError('homeError', res.error);
      enterRoom(res.code, res.token);
    }
  );
});

function enterRoom(code, token) {
  currentCode = code;
  saveSession(code, token);
  history.replaceState(null, '', `?room=${code}`);
}

function tryRejoin(code) {
  const token = localStorage.getItem(tokenKey(code));
  if (!token) return false;
  socket.emit('joinRoom', { code, token, tokenOnly: true }, (res) => {
    if (res.ok) {
      enterRoom(res.code, res.token);
    } else {
      clearSession(code);
      currentCode = null;
      state = null;
      show('home');
      selectTab('join');
      $('joinForm').code.value = code;
      if (res.error !== 'Sessiya eskirgan') showError('homeError', res.error);
    }
  });
  return true;
}

function leaveRoom() {
  if (!confirm('Xonadan chiqmoqchimisiz?')) return;
  socket.emit('leaveRoom', null, () => {
    clearSession(currentCode);
    currentCode = null;
    state = null;
    history.replaceState(null, '', '/');
    show('home');
  });
}
document.querySelectorAll('.leave-btn').forEach((b) => b.addEventListener('click', leaveRoom));

// ---------- Kutish xonasi ----------
$('copyLink').addEventListener('click', async () => {
  const pw = sessionStorage.getItem(`uno:pw:${currentCode}`);
  const text = `UNO o'ynaymiz! 🎴\nHavola: ${$('shareLink').value}\nXona kodi: ${currentCode}` + (pw ? `\nParol: ${pw}` : '');
  try {
    await navigator.clipboard.writeText(text);
    toast('Havola nusxalandi!');
  } catch {
    $('shareLink').select();
    toast('Havolani qo\'lda nusxalang');
  }
});

$('startBtn').addEventListener('click', () => {
  socket.emit('startGame', null, (res) => !res.ok && showError('lobbyError', res.error));
});

function renderLobby() {
  show('lobby');
  const isHost = state.hostId === state.me;
  $('lobbyCode').textContent = state.code;
  $('shareLink').value = `${location.origin}/?room=${state.code}`;
  const pw = sessionStorage.getItem(`uno:pw:${state.code}`);
  $('hostPassword').textContent = pw ? `Parol: ${pw}` : '';
  $('playerCount').textContent = state.players.length;

  const list = $('lobbyPlayers');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    if (!p.connected) li.classList.add('offline');
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === state.me ? ' (siz)' : '');
    if (p.id === state.hostId) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'egasi';
      name.appendChild(b);
    }
    li.appendChild(name);
    if (isHost && p.id !== state.me) {
      const kick = document.createElement('button');
      kick.className = 'kick';
      kick.textContent = 'chiqarish';
      kick.onclick = () => socket.emit('kick', { targetId: p.id }, (r) => !r.ok && showError('lobbyError', r.error));
      li.appendChild(kick);
    }
    list.appendChild(li);
  }

  $('startBtn').classList.toggle('hidden', !isHost);
  $('startBtn').disabled = state.players.filter((p) => p.connected).length < state.minPlayers;
  $('startBtn').textContent =
    state.players.length < state.minPlayers ? `Kamida ${state.minPlayers} kishi kerak` : "O'yinni boshlash";
  $('waitHost').classList.toggle('hidden', isHost);
}

// ---------- O'yin ----------
function cardEl(card) {
  const el = document.createElement('div');
  el.className = `card ${card.color}`;
  const span = document.createElement('span');
  span.textContent = SYMBOLS[card.value] || card.value;
  el.appendChild(span);
  return el;
}

function renderGame() {
  show('game');
  const myTurn = state.status === 'playing' && state.turnId === state.me;
  const meIdx = state.players.findIndex((p) => p.id === state.me);

  // Raqiblar (o'zimizdan keyingi tartibda)
  const opp = $('opponents');
  opp.innerHTML = '';
  const ordered = [...state.players.slice(meIdx + 1), ...state.players.slice(0, meIdx)];
  for (const p of ordered) {
    const box = document.createElement('div');
    box.className = 'opponent' + (p.id === state.turnId ? ' turn' : '') + (p.connected ? '' : ' offline');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name + (p.connected ? '' : ' (uzildi)');
    box.appendChild(name);
    const cards = document.createElement('div');
    cards.className = 'cards';
    for (let i = 0; i < Math.min(p.count, 10); i++) {
      const m = document.createElement('div');
      m.className = 'mini-card';
      cards.appendChild(m);
    }
    box.appendChild(cards);
    const count = document.createElement('div');
    count.textContent = `${p.count} ta karta`;
    box.appendChild(count);
    if (p.count === 1 && !p.unoPending) {
      const tag = document.createElement('div');
      tag.className = 'uno-tag';
      tag.textContent = 'UNO!';
      box.appendChild(tag);
    }
    if (p.unoPending && state.status === 'playing') {
      const btn = document.createElement('button');
      btn.className = 'catch-btn';
      btn.textContent = 'UNO demadi! Ushlash';
      btn.onclick = () => socket.emit('catchUno', { targetId: p.id }, (r) => !r.ok && showError('gameError', r.error));
      box.appendChild(btn);
    }
    opp.appendChild(box);
  }

  // Stol
  $('discard').innerHTML = '';
  $('discard').appendChild(cardEl(state.top));
  $('colorInfo').innerHTML = '';
  $('colorInfo').append(`Rang: ${COLOR_NAMES[state.currentColor]}`);
  const dot = document.createElement('span');
  dot.className = 'color-dot';
  dot.style.background = `var(--${state.currentColor})`;
  $('colorInfo').appendChild(dot);
  $('deckCount').textContent = `${state.deckCount} ta`;
  $('direction').textContent = state.direction === 1 ? '↻' : '↺';
  $('deck').classList.toggle('active', myTurn && state.drawnCardId === null);

  const turnPlayer = state.players.find((p) => p.id === state.turnId);
  if (myTurn) {
    $('turnInfo').textContent =
      state.drawnCardId !== null ? 'Olgan kartangizni tashlang yoki o\'tkazing' : 'Sizning navbatingiz!';
  } else {
    $('turnInfo').textContent = turnPlayer ? `${turnPlayer.name} yurmoqda...` : '';
  }

  $('passBtn').classList.toggle('hidden', !(myTurn && state.drawnCardId !== null));

  // Mening kartalarim
  const hand = $('hand');
  hand.innerHTML = '';
  hand.classList.toggle('my-turn', myTurn);
  const playable = new Set(state.playable);
  for (const c of state.hand) {
    const el = cardEl(c);
    if (playable.has(c.id)) {
      el.classList.add('playable');
      el.onclick = () => playCard(c);
    }
    hand.appendChild(el);
  }

  // Jurnal
  const log = $('log');
  log.innerHTML = '';
  for (const line of [...state.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    log.appendChild(li);
  }

  // G'olib
  if (state.status === 'finished') {
    const w = state.players.find((p) => p.id === state.winnerId);
    $('winnerText').textContent = w ? (w.id === state.me ? '🏆 Siz yutdingiz!' : `🏆 ${w.name} yutdi!`) : "O'yin tugadi";
    const isHost = state.hostId === state.me;
    $('againBtn').classList.toggle('hidden', !isHost);
    $('lobbyBtn').classList.toggle('hidden', !isHost);
    $('waitAgain').classList.toggle('hidden', isHost);
    $('winner').classList.remove('hidden');
  } else {
    $('winner').classList.add('hidden');
  }
}

function playCard(card) {
  if (card.color === 'wild') {
    pendingWildCardId = card.id;
    $('colorPicker').classList.remove('hidden');
    return;
  }
  socket.emit('playCard', { cardId: card.id }, (r) => !r.ok && showError('gameError', r.error));
}

document.querySelectorAll('.color-btn').forEach((b) => {
  b.addEventListener('click', () => {
    $('colorPicker').classList.add('hidden');
    if (pendingWildCardId === null) return;
    socket.emit('playCard', { cardId: pendingWildCardId, color: b.dataset.color }, (r) => !r.ok && showError('gameError', r.error));
    pendingWildCardId = null;
  });
});
$('cancelColor').addEventListener('click', () => {
  pendingWildCardId = null;
  $('colorPicker').classList.add('hidden');
});

$('deck').addEventListener('click', () => {
  if (!state || state.turnId !== state.me || state.drawnCardId !== null) return;
  socket.emit('drawCard', null, (r) => !r.ok && showError('gameError', r.error));
});
$('passBtn').addEventListener('click', () => {
  socket.emit('pass', null, (r) => !r.ok && showError('gameError', r.error));
});
$('unoBtn').addEventListener('click', () => {
  socket.emit('sayUno', null, (r) => {
    if (!r.ok) return showError('gameError', r.error);
    toast('UNO! 🔥');
  });
});
$('againBtn').addEventListener('click', () => {
  socket.emit('startGame', null, (r) => !r.ok && toast(r.error));
});
$('lobbyBtn').addEventListener('click', () => socket.emit('backToLobby'));

// ---------- Server hodisalari ----------
socket.on('state', (s) => {
  state = s;
  if (s.status === 'lobby') {
    $('winner').classList.add('hidden');
    renderLobby();
  } else {
    renderGame();
  }
});

socket.on('kicked', () => {
  clearSession(currentCode);
  currentCode = null;
  state = null;
  history.replaceState(null, '', '/');
  show('home');
  showError('homeError', 'Sizni xonadan chiqarishdi');
});

socket.on('connect', () => {
  // Internet uzilib qayta ulansa, xonaga qaytamiz
  if (currentCode) tryRejoin(currentCode);
});

// ---------- Boshlang'ich holat ----------
(function init() {
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase();
  if (roomParam) {
    $('joinForm').code.value = roomParam;
    selectTab('join');
    if (localStorage.getItem(tokenKey(roomParam))) currentCode = roomParam; // 'connect' da qayta ulanadi
    else $('joinForm').password.focus();
  }
})();
