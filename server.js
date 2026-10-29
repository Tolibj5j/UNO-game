'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const HAND_SIZE = 7;
const COLORS = ['red', 'yellow', 'green', 'blue'];
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // hamma chiqib ketsa, xona 10 daqiqadan keyin o'chadi

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- Yordamchi funksiyalar ----------

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  } while (rooms.has(code));
  return code;
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 32).toString('hex');
}

function checkPassword(room, pw) {
  const a = Buffer.from(hashPassword(pw, room.salt), 'hex');
  const b = Buffer.from(room.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, maxLen);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) {
    deck.push({ id: id++, color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: id++, color, value: String(n) });
      deck.push({ id: id++, color, value: String(n) });
    }
    for (const v of ['skip', 'reverse', 'draw2']) {
      deck.push({ id: id++, color, value: v });
      deck.push({ id: id++, color, value: v });
    }
  }
  for (let k = 0; k < 4; k++) {
    deck.push({ id: id++, color: 'wild', value: 'wild' });
    deck.push({ id: id++, color: 'wild', value: 'wild4' });
  }
  return shuffle(deck); // 108 ta karta
}

const VALUE_LABEL = { skip: "O'tkazish", reverse: 'Teskari', draw2: '+2', wild: 'Rang tanlash', wild4: '+4' };
const COLOR_LABEL = { red: 'qizil', yellow: 'sariq', green: 'yashil', blue: "ko'k", wild: '' };
function cardText(card) {
  const v = VALUE_LABEL[card.value] || card.value;
  return card.color === 'wild' ? v : `${COLOR_LABEL[card.color]} ${v}`;
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 30) room.log.shift();
}

function topCard(room) {
  return room.discard[room.discard.length - 1];
}

function canPlay(room, card) {
  if (card.color === 'wild') return true;
  const top = topCard(room);
  return card.color === room.currentColor || card.value === top.value;
}

function drawFromDeck(room) {
  if (room.deck.length === 0) {
    if (room.discard.length <= 1) return null; // karta qolmadi
    const top = room.discard.pop();
    room.deck = shuffle(room.discard);
    room.discard = [top];
    addLog(room, 'Koloda aralashtirildi');
  }
  return room.deck.pop();
}

function giveCards(room, player, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    const c = drawFromDeck(room);
    if (!c) break;
    player.hand.push(c);
    drawn.push(c);
  }
  if (player.hand.length !== 1) player.unoPending = false;
  player.saidUno = false;
  return drawn;
}

function connectedCount(room) {
  return room.players.filter((p) => p.connected).length;
}

/** Keyingi ulangan o'yinchi indeksini qaytaradi */
function nextIndex(room, from) {
  const n = room.players.length;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + room.direction + n) % n;
    if (room.players[i].connected) return i;
  }
  return from;
}

function currentPlayer(room) {
  return room.players[room.turn];
}

// ---------- O'yin boshqaruvi ----------

function startGame(room) {
  room.deck = buildDeck();
  room.discard = [];
  room.direction = 1;
  room.winnerId = null;
  room.drawnCardId = null;
  room.log = [];
  for (const p of room.players) {
    p.hand = [];
    p.unoPending = false;
    p.saidUno = false;
  }
  for (let k = 0; k < HAND_SIZE; k++) {
    for (const p of room.players) p.hand.push(room.deck.pop());
  }
  // Birinchi karta raqamli bo'lishi kerak
  let first;
  while (true) {
    first = room.deck.pop();
    if (/^\d$/.test(first.value)) break;
    room.deck.unshift(first);
  }
  room.discard.push(first);
  room.currentColor = first.color;

  // Birinchi yurishni tasodifiy ulangan o'yinchi qiladi
  const active = room.players.map((p, i) => (p.connected ? i : -1)).filter((i) => i >= 0);
  room.turn = active[crypto.randomInt(active.length)];
  room.status = 'playing';
  addLog(room, `O'yin boshlandi! Birinchi karta: ${cardText(first)}`);
  addLog(room, `${currentPlayer(room).name} birinchi yuradi`);
}

function finishGame(room, winner) {
  room.status = 'finished';
  room.winnerId = winner.id;
  room.drawnCardId = null;
  addLog(room, `🏆 ${winner.name} g'olib bo'ldi!`);
}

function handlePlay(room, player, cardId, chosenColor) {
  if (room.status !== 'playing') return 'O\'yin hali boshlanmagan';
  if (currentPlayer(room).id !== player.id) return 'Hozir sizning navbatingiz emas';
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return 'Bu karta sizda yo\'q';
  if (room.drawnCardId !== null && room.drawnCardId !== cardId) {
    return 'Faqat hozir olgan kartangizni tashlashingiz yoki o\'tkazishingiz mumkin';
  }
  const card = player.hand[idx];
  if (!canPlay(room, card)) return 'Bu kartani tashlab bo\'lmaydi';
  if (card.color === 'wild' && !COLORS.includes(chosenColor)) return 'Rangni tanlang';

  player.hand.splice(idx, 1);
  room.discard.push(card);
  room.currentColor = card.color === 'wild' ? chosenColor : card.color;
  room.drawnCardId = null;

  let msg = `${player.name}: ${cardText(card)}`;
  if (card.color === 'wild') msg += ` → ${COLOR_LABEL[chosenColor]}`;
  addLog(room, msg);

  if (player.hand.length === 0) {
    finishGame(room, player);
    return null;
  }
  if (player.hand.length === 1) {
    player.unoPending = !player.saidUno;
    if (player.saidUno) addLog(room, `${player.name}: UNO! 🔥`);
  } else {
    player.unoPending = false;
  }
  player.saidUno = false;

  const activeCount = connectedCount(room);
  switch (card.value) {
    case 'skip': {
      const skipped = nextIndex(room, room.turn);
      addLog(room, `${room.players[skipped].name} navbatini o'tkazib yubordi`);
      room.turn = nextIndex(room, skipped);
      break;
    }
    case 'reverse': {
      if (activeCount <= 2) {
        // 2 kishida "teskari" = "o'tkazish"
        const skipped = nextIndex(room, room.turn);
        room.turn = nextIndex(room, skipped);
      } else {
        room.direction *= -1;
        room.turn = nextIndex(room, room.turn);
      }
      addLog(room, "Yo'nalish o'zgardi");
      break;
    }
    case 'draw2':
    case 'wild4': {
      const n = card.value === 'draw2' ? 2 : 4;
      const victimIdx = nextIndex(room, room.turn);
      const victim = room.players[victimIdx];
      giveCards(room, victim, n);
      addLog(room, `${victim.name} ${n} ta karta oldi va navbatini o'tkazdi`);
      room.turn = nextIndex(room, victimIdx);
      break;
    }
    default:
      room.turn = nextIndex(room, room.turn);
  }
  return null;
}

function handleDraw(room, player) {
  if (room.status !== 'playing') return 'O\'yin hali boshlanmagan';
  if (currentPlayer(room).id !== player.id) return 'Hozir sizning navbatingiz emas';
  if (room.drawnCardId !== null) return 'Siz allaqachon karta oldingiz';
  const [card] = giveCards(room, player, 1);
  if (!card) {
    addLog(room, `${player.name}: kolodada karta qolmadi, navbat o'tdi`);
    room.turn = nextIndex(room, room.turn);
    return null;
  }
  if (canPlay(room, card)) {
    room.drawnCardId = card.id; // olgan kartani tashlashi yoki o'tkazishi mumkin
    addLog(room, `${player.name} karta oldi`);
  } else {
    addLog(room, `${player.name} karta oldi va navbatni o'tkazdi`);
    room.turn = nextIndex(room, room.turn);
  }
  return null;
}

function handlePass(room, player) {
  if (room.status !== 'playing') return 'O\'yin hali boshlanmagan';
  if (currentPlayer(room).id !== player.id) return 'Hozir sizning navbatingiz emas';
  if (room.drawnCardId === null) return 'Avval kolodadan karta oling';
  room.drawnCardId = null;
  addLog(room, `${player.name} navbatni o'tkazdi`);
  room.turn = nextIndex(room, room.turn);
  return null;
}

function handleSayUno(room, player) {
  if (room.status !== 'playing') return null;
  if (player.hand.length === 2) {
    player.saidUno = true;
  } else if (player.hand.length === 1 && player.unoPending) {
    player.unoPending = false;
    addLog(room, `${player.name}: UNO! 🔥`);
  } else {
    return 'UNO faqat 1-2 ta karta qolganda aytiladi';
  }
  return null;
}

function handleCatch(room, player, targetId) {
  if (room.status !== 'playing') return null;
  const target = room.players.find((p) => p.id === targetId);
  if (!target || target.id === player.id) return 'Noto\'g\'ri o\'yinchi';
  if (!target.unoPending || target.hand.length !== 1) return 'Kech qoldingiz!';
  giveCards(room, target, 2);
  addLog(room, `${player.name} ${target.name}ni ushladi! ${target.name} UNO demadi va 2 ta karta oldi`);
  return null;
}

// ---------- Holatni yuborish ----------

function publicState(room, viewer) {
  const base = {
    code: room.code,
    hostId: room.hostId,
    me: viewer.id,
    status: room.status,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      count: p.hand.length,
      connected: p.connected,
      unoPending: p.unoPending,
    })),
    log: room.log,
  };
  if (room.status === 'lobby') return base;
  const top = topCard(room);
  return {
    ...base,
    hand: viewer.hand,
    top,
    currentColor: room.currentColor,
    turnId: currentPlayer(room)?.id ?? null,
    direction: room.direction,
    drawnCardId: currentPlayer(room)?.id === viewer.id ? room.drawnCardId : null,
    deckCount: room.deck.length,
    winnerId: room.winnerId,
    playable:
      room.status === 'playing' && currentPlayer(room).id === viewer.id
        ? viewer.hand
            .filter((c) => (room.drawnCardId === null ? true : c.id === room.drawnCardId) && canPlay(room, c))
            .map((c) => c.id)
        : [],
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit('state', publicState(room, p));
    }
  }
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanupTimer);
  if (connectedCount(room) === 0) {
    room.cleanupTimer = setTimeout(() => {
      if (connectedCount(room) === 0) rooms.delete(room.code);
    }, EMPTY_ROOM_TTL_MS);
  }
}

function ensureHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || !host.connected) {
    const next = room.players.find((p) => p.connected);
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      addLog(room, `${next.name} endi xona egasi`);
    }
  }
}

function removePlayer(room, player) {
  const idx = room.players.indexOf(player);
  if (idx === -1) return;
  clearTimeout(player.removeTimer);
  const turnId = room.status === 'playing' ? currentPlayer(room)?.id : null;
  room.players.splice(idx, 1);
  if (turnId) {
    const newTurn = room.players.findIndex((p) => p.id === turnId);
    room.turn = newTurn >= 0 ? newTurn : 0;
  }
  addLog(room, `${player.name} xonadan chiqdi`);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  ensureHost(room);
}

/** O'yin paytida o'yinchi uzilsa yoki chiqsa */
function onPlayerGone(room, player) {
  if (room.status === 'playing' && currentPlayer(room)?.id === player.id) {
    room.drawnCardId = null;
    room.turn = nextIndex(room, room.turn);
  }
}

function makePlayer(name, socketId) {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    token: crypto.randomBytes(24).toString('hex'),
    name,
    socketId,
    connected: true,
    hand: [],
    unoPending: false,
    saidUno: false,
  };
}

// ---------- Socket hodisalari ----------

io.on('connection', (socket) => {
  const reply = (cb, data) => typeof cb === 'function' && cb(data);

  function ctx() {
    const room = rooms.get(socket.data.code);
    if (!room) return {};
    const player = room.players.find((p) => p.id === socket.data.playerId);
    return { room, player };
  }

  function attach(room, player) {
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
  }

  socket.on('createRoom', (data, cb) => {
    const name = cleanText(data?.name, 16);
    const password = typeof data?.password === 'string' ? data.password.slice(0, 32) : '';
    if (!name) return reply(cb, { ok: false, error: 'Ismingizni kiriting' });
    if (password.length < 3) return reply(cb, { ok: false, error: 'Parol kamida 3 ta belgidan iborat bo\'lsin' });

    const code = randomCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const player = makePlayer(name, socket.id);
    const room = {
      code,
      salt,
      passwordHash: hashPassword(password, salt),
      hostId: player.id,
      players: [player],
      status: 'lobby',
      log: [],
      deck: [],
      discard: [],
      direction: 1,
      turn: 0,
      drawnCardId: null,
      currentColor: null,
      winnerId: null,
      cleanupTimer: null,
    };
    addLog(room, `${name} xona yaratdi`);
    rooms.set(code, room);
    attach(room, player);
    reply(cb, { ok: true, code, token: player.token });
    broadcast(room);
  });

  socket.on('joinRoom', (data, cb) => {
    const code = cleanText(data?.code, 6).toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply(cb, { ok: false, error: 'Bunday xona topilmadi' });

    // Qayta ulanish (sahifa yangilansa yoki internet uzilsa)
    if (typeof data?.token === 'string' && data.token) {
      const existing = room.players.find((p) => p.token === data.token);
      if (existing) {
        if (existing.socketId && existing.socketId !== socket.id) {
          io.sockets.sockets.get(existing.socketId)?.disconnect(true);
        }
        clearTimeout(existing.removeTimer);
        existing.socketId = socket.id;
        existing.connected = true;
        attach(room, existing);
        clearTimeout(room.cleanupTimer);
        ensureHost(room);
        addLog(room, `${existing.name} qayta ulandi`);
        reply(cb, { ok: true, code, token: existing.token });
        return broadcast(room);
      }
      if (data.tokenOnly) return reply(cb, { ok: false, error: 'Sessiya eskirgan' });
    }

    const name = cleanText(data?.name, 16);
    const password = typeof data?.password === 'string' ? data.password.slice(0, 32) : '';
    if (!name) return reply(cb, { ok: false, error: 'Ismingizni kiriting' });
    if (!checkPassword(room, password)) return reply(cb, { ok: false, error: 'Parol noto\'g\'ri' });
    if (room.status !== 'lobby') return reply(cb, { ok: false, error: 'O\'yin allaqachon boshlangan' });
    if (room.players.length >= MAX_PLAYERS) return reply(cb, { ok: false, error: `Xona to'la (maksimum ${MAX_PLAYERS} kishi)` });
    if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return reply(cb, { ok: false, error: 'Bu ism band, boshqa ism tanlang' });
    }

    const player = makePlayer(name, socket.id);
    room.players.push(player);
    clearTimeout(room.cleanupTimer);
    ensureHost(room);
    attach(room, player);
    addLog(room, `${name} xonaga qo'shildi`);
    reply(cb, { ok: true, code, token: player.token });
    broadcast(room);
  });

  socket.on('startGame', (_, cb) => {
    const { room, player } = ctx();
    if (!room || !player) return reply(cb, { ok: false, error: 'Xona topilmadi' });
    if (room.hostId !== player.id) return reply(cb, { ok: false, error: 'Faqat xona egasi boshlay oladi' });
    if (room.status === 'playing') return reply(cb, { ok: false, error: 'O\'yin allaqachon ketmoqda' });
    // Uzilib qolgan o'yinchilarni olib tashlaymiz
    room.players = room.players.filter((p) => p.connected);
    if (room.players.length < MIN_PLAYERS) {
      return reply(cb, { ok: false, error: `Kamida ${MIN_PLAYERS} ta o'yinchi kerak` });
    }
    startGame(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('backToLobby', (_, cb) => {
    const { room, player } = ctx();
    if (!room || !player) return reply(cb, { ok: false });
    if (room.hostId !== player.id || room.status !== 'finished') return reply(cb, { ok: false });
    room.status = 'lobby';
    room.players = room.players.filter((p) => p.connected);
    for (const p of room.players) p.hand = [];
    reply(cb, { ok: true });
    broadcast(room);
  });

  const gameAction = (handler) => (data, cb) => {
    const { room, player } = ctx();
    if (!room || !player) return reply(cb, { ok: false, error: 'Xona topilmadi' });
    const error = handler(room, player, data || {});
    reply(cb, error ? { ok: false, error } : { ok: true });
    if (!error) broadcast(room);
  };

  socket.on('playCard', gameAction((room, player, d) => handlePlay(room, player, Number(d.cardId), d.color)));
  socket.on('drawCard', gameAction((room, player) => handleDraw(room, player)));
  socket.on('pass', gameAction((room, player) => handlePass(room, player)));
  socket.on('sayUno', gameAction((room, player) => handleSayUno(room, player)));
  socket.on('catchUno', gameAction((room, player, d) => handleCatch(room, player, String(d.targetId))));

  socket.on('kick', gameAction((room, player, d) => {
    if (room.hostId !== player.id) return 'Faqat xona egasi chiqara oladi';
    if (room.status !== 'lobby') return 'O\'yin paytida chiqarib bo\'lmaydi';
    const target = room.players.find((p) => p.id === String(d.targetId));
    if (!target || target.id === player.id) return 'Noto\'g\'ri o\'yinchi';
    if (target.socketId) {
      io.to(target.socketId).emit('kicked');
      io.sockets.sockets.get(target.socketId)?.leave(room.code);
    }
    removePlayer(room, target);
    return null;
  }));

  socket.on('leaveRoom', (_, cb) => {
    const { room, player } = ctx();
    socket.data.code = null;
    socket.data.playerId = null;
    if (!room || !player) return reply(cb, { ok: true });
    socket.leave(room.code);
    if (room.status === 'playing') {
      onPlayerGone(room, player);
      removePlayer(room, player);
      if (rooms.has(room.code) && room.players.length === 1) finishGame(room, room.players[0]);
    } else {
      removePlayer(room, player);
    }
    reply(cb, { ok: true });
    if (rooms.has(room.code)) broadcast(room);
  });

  socket.on('disconnect', () => {
    const { room, player } = ctx();
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (room.status === 'lobby') {
      // Sahifani yangilash uchun 30 soniya vaqt beramiz
      clearTimeout(player.removeTimer);
      player.removeTimer = setTimeout(() => {
        if (!player.connected && rooms.get(room.code) === room && room.status === 'lobby') {
          removePlayer(room, player);
          if (rooms.has(room.code)) broadcast(room);
        }
      }, 30 * 1000);
    } else {
      addLog(room, `${player.name} uzilib qoldi`);
      onPlayerGone(room, player);
      ensureHost(room);
    }
    if (rooms.has(room.code)) {
      scheduleCleanup(room);
      broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`UNO server ishga tushdi: http://localhost:${PORT}`);
});
