import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const questions = JSON.parse(fs.readFileSync(path.join(here, 'questions.json'), 'utf8'));
const rooms = new Map();

function send(socket, payload) {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  socket.write(Buffer.concat([head, body]));
}
function broadcast(room, payload) { for (const player of room.players.values()) send(player.socket, payload); }
function updateRoom(room) { broadcast(room, { type: 'roomStatus', count: room.players.size }); }
function pickThree(room) {
  const candidates = questions.filter(q => !room.recent.has(q.id));
  const pool = candidates.length >= 3 ? candidates : questions;
  const result = [...pool].sort(() => Math.random() - .5).slice(0, 3);
  result.forEach(q => room.recent.add(q.id));
  if (room.recent.size > 25) room.recent = new Set(result.map(q => q.id));
  return result;
}
function parseClientFrames(socket, chunk) {
  socket.buffer = Buffer.concat([socket.buffer || Buffer.alloc(0), chunk]);
  while (socket.buffer.length >= 2) {
    const first = socket.buffer[0], second = socket.buffer[1];
    let length = second & 127, offset = 2;
    if (length === 126) { if (socket.buffer.length < 4) return; length = socket.buffer.readUInt16BE(2); offset = 4; }
    if (!(second & 128) || socket.buffer.length < offset + 4 + length) return;
    const mask = socket.buffer.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.from(socket.buffer.subarray(offset, offset + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    socket.buffer = socket.buffer.subarray(offset + length);
    if ((first & 15) === 8) return socket.end();
    if ((first & 15) === 1) { try { handle(socket, JSON.parse(payload.toString('utf8'))); } catch { send(socket, { type: 'error', message: '訊息格式無法辨識。' }); } }
  }
}
function leave(socket) {
  const { roomCode, playerId } = socket.meta || {};
  if (!roomCode) return;
  const room = rooms.get(roomCode); if (!room) return;
  room.players.delete(playerId);
  if (!room.players.size) rooms.delete(roomCode);
  else { room.started = false; broadcast(room, { type: 'opponentLeft' }); updateRoom(room); }
}
function handle(socket, message) {
  if (message.type === 'join') {
    leave(socket);
    const code = String(message.room || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 4) return send(socket, { type: 'error', message: '請輸入 4–8 碼英數房間代碼。' });
    let room = rooms.get(code);
    if (!room) { room = { players: new Map(), started: false, recent: new Set(), lastAttack: new Map() }; rooms.set(code, room); }
    if (room.players.size >= 2) return send(socket, { type: 'error', message: '這個房間已滿，請使用另一組代碼。' });
    const playerId = crypto.randomUUID();
    socket.meta = { roomCode: code, playerId };
    room.players.set(playerId, { socket, name: String(message.name || '').slice(0, 18) || '同學' });
    send(socket, { type: 'joined', room: code, playerId }); updateRoom(room);
    if (room.players.size === 2) { room.started = true; broadcast(room, { type: 'gameStart' }); }
    return;
  }
  const { roomCode, playerId } = socket.meta || {}; const room = rooms.get(roomCode); if (!room) return;
  const opponent = [...room.players.entries()].find(([id]) => id !== playerId)?.[1];
  if (message.type === 'cleared') {
    const now = Date.now();
    if (!room.started || !opponent || now - (room.lastAttack.get(playerId) || 0) < 700) return;
    room.lastAttack.set(playerId, now);
    const quiz = pickThree(room).map(({id,q,options}) => ({ id,q,options }));
    send(opponent.socket, { type: 'quiz', questions: quiz, triggerLines: Math.min(4, Math.max(1, Number(message.lines) || 1)) });
  }
  if (message.type === 'quizAnswers') {
    const answers = Array.isArray(message.answers) ? message.answers : [];
    const correct = answers.reduce((sum, item) => sum + (questions.find(q => q.id === item.id)?.answer === item.answer ? 1 : 0), 0);
    send(socket, { type: 'quizFeedback', correct, total: answers.length });
    if (opponent) send(opponent.socket, { type: 'opponentQuizDone' });
  }
  if (message.type === 'gameOver') {
    if (opponent) send(opponent.socket, { type: 'opponentLost' });
  }
}

const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const server = http.createServer((req,res) => {
  const safe = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([.][.][\\/])+/, '');
  const file = path.join(publicDir, safe === '/' ? 'index.html' : safe);
  if (!file.startsWith(publicDir) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); fs.createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const key = req.headers['sec-websocket-key']; if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('data', chunk => parseClientFrames(socket, chunk)); socket.on('close', () => leave(socket)); socket.on('error', () => leave(socket));
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => console.log(`護理方塊對戰已啟動：http://localhost:${port}`));
