import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Tất cả dữ liệu phát sinh được gom vào một thư mục duy nhất.
// Trên Railway hãy mount Volume vào /app/storage.
const storageRoot = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, 'storage');
const dataDir = path.join(storageRoot, 'data');
const backupDir = path.join(storageRoot, 'backups');
const uploadDir = path.join(storageRoot, 'uploads');
const sessionDir = path.join(storageRoot, 'sessions');
for (const dir of [storageRoot, dataDir, backupDir, uploadDir, sessionDir]) fs.mkdirSync(dir, { recursive: true });

const dbPath = path.join(dataDir, 'db.json');
const sessionStorePath = path.join(sessionDir, 'sessions.json');
const sessionSecretPath = path.join(storageRoot, '.session-secret');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(sessionSecretPath)) return fs.readFileSync(sessionSecretPath, 'utf8').trim();
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(sessionSecretPath, secret, { mode: 0o600 });
    console.warn('[Security] Chưa đặt SESSION_SECRET; đã tạo secret bền vững trong Volume. Nên đặt SESSION_SECRET trên Railway.');
    return secret;
  } catch {
    return crypto.randomBytes(48).toString('hex');
  }
}

class JsonFileSessionStore extends session.Store {
  constructor(file) {
    super();
    this.file = file;
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '{}');
  }
  readAll() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; }
    catch { return {}; }
  }
  writeAll(value) {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, this.file);
  }
  prune(all) {
    let changed = false;
    const now = Date.now();
    for (const [sid, sess] of Object.entries(all)) {
      const expires = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : 0;
      if (expires && expires <= now) { delete all[sid]; changed = true; }
    }
    return changed;
  }
  get(sid, callback) {
    try {
      const all = this.readAll();
      if (this.prune(all)) this.writeAll(all);
      const sess = all[sid] || null;
      if (sess?.cookie?.expires) sess.cookie.expires = new Date(sess.cookie.expires);
      callback(null, sess);
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const all = this.readAll();
      this.prune(all);
      all[sid] = sess;
      this.writeAll(all);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try {
      const all = this.readAll();
      delete all[sid];
      this.writeAll(all);
      callback(null);
    } catch (error) { callback(error); }
  }
  touch(sid, sess, callback = () => {}) {
    try {
      const all = this.readAll();
      if (all[sid]) {
        all[sid].cookie = sess.cookie;
        this.writeAll(all);
      }
      callback(null);
    } catch (error) { callback(error); }
  }
}

const persistentSessionStore = new JsonFileSessionStore(sessionStorePath);

// Tự di chuyển dữ liệu từ các bản cũ trong lần khởi động đầu tiên.
const legacyCandidates = [
  path.join(storageRoot, 'db.json'), // Volume cũ từng mount trực tiếp vào /app/data rồi chuyển sang /app/storage
  path.join(__dirname, 'data', 'db.json') // Dữ liệu được đóng gói trong source cũ
];
if (!fs.existsSync(dbPath)) {
  const legacyDb = legacyCandidates.find(candidate => fs.existsSync(candidate));
  if (legacyDb) {
    try {
      fs.copyFileSync(legacyDb, dbPath);
      console.log(`[Storage] Đã migrate database từ ${legacyDb} -> ${dbPath}`);
    } catch (error) {
      console.error('[Storage] Không thể migrate database cũ:', error.message);
    }
  }
}

// Nếu bản cũ có public/uploads hoặc backups thì copy sang storage lần đầu.
function migrateDirectoryOnce(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  try {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const src = path.join(sourceDir, entry.name);
      const dst = path.join(targetDir, entry.name);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  } catch (error) {
    console.error(`[Storage] Không thể migrate ${sourceDir}:`, error.message);
  }
}
migrateDirectoryOnce(path.join(__dirname, 'public', 'uploads'), uploadDir);
migrateDirectoryOnce(path.join(__dirname, 'backups'), backupDir);
const defaultDb = { users: [], music: [], logs: [], chat: [], notifications: [], teamPosts: [] };
const normalizeDb = db => ({ ...defaultDb, ...(db || {}), users: db?.users || [], music: db?.music || [], logs: db?.logs || [], chat: db?.chat || [], notifications: db?.notifications || [], teamPosts: db?.teamPosts || [] });
const load = () => { try { return normalizeDb(JSON.parse(fs.readFileSync(dbPath, 'utf8'))); } catch { return structuredClone(defaultDb); } };
const save = db => fs.writeFileSync(dbPath, JSON.stringify(normalizeDb(db), null, 2));
if (!fs.existsSync(dbPath)) save(defaultDb);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: persistentSessionStore,
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use('/uploads', express.static(uploadDir));
app.use((req, res, next) => {
  if (['/', '/index.html', '/app.js', '/pwa.js', '/offline-db.js', '/sw.js', '/manifest.webmanifest'].includes(req.path)) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 10 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });
const toolLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const diskStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const avatarUpload = multer({
  storage: diskStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype))
});
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

function cleanText(value, max = 200) { return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max); }
function safeUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    avatar: u.avatar || '',
    banned: !!u.banned,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen || null,
    bio: u.bio || '',
    games: u.games || '',
    gameId: u.gameId || '',
    discord: u.discord || '',
    achievements: Array.isArray(u.achievements) ? u.achievements : []
  };
}
function auth(req, res, next) {
  const db = load();
  const u = db.users.find(x => x.id === req.session.uid);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
  if (u.banned) return res.status(403).json({ error: 'Tài khoản đã bị cấm' });
  req.user = u;
  req.session.meta = { ...(req.session.meta || {}), ...requestMeta(req), createdAt: req.session.meta?.createdAt || new Date().toISOString() };
  next();
}
function admin(req, res, next) {
  if (!['Boss', 'Kì Cựu'].includes(req.user.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  next();
}
function addLog(db, action, extra = {}) { db.logs.push({ at: new Date().toISOString(), action, ...extra }); }
function notifyUser(db, userId, type, title, message, extra = {}) {
  if (!userId) return;
  db.notifications.push({ id: crypto.randomUUID(), userId, type, title: cleanText(title, 100), message: cleanText(message, 240), read: false, createdAt: new Date().toISOString(), ...extra });
  if (db.notifications.length > 2000) db.notifications = db.notifications.slice(-2000);
}
function sessionToken(sid) { return crypto.createHash('sha256').update(sid).digest('hex').slice(0, 20); }
function requestMeta(req) { return { userAgent: cleanText(req.get('user-agent') || 'Thiết bị không xác định', 180), ip: cleanText(req.ip || '', 80), lastSeen: new Date().toISOString() }; }

app.get('/api/health', (req, res) => res.json({
  ok: true,
  version: '1.4.0',
  storage: { root: storageRoot, data: dataDir, uploads: uploadDir, backups: backupDir }
}));

app.post('/api/register', async (req, res) => {
  const username = cleanText(req.body.username, 30);
  const password = String(req.body.password || '');
  const displayName = cleanText(req.body.displayName || username, 40);
  if (!username || !password || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Thông tin chưa hợp lệ' });
  const db = load();
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
  const first = db.users.length === 0;
  const u = {
    id: crypto.randomUUID(), username, displayName, passwordHash: await bcrypt.hash(password, 12), role: first ? 'Boss' : 'Member', avatar: '', banned: false,
    bio: '', games: '', gameId: '', discord: '', achievements: [], createdAt: new Date().toISOString(), lastSeen: new Date().toISOString()
  };
  db.users.push(u);
  addLog(db, 'register', { user: u.username });
  save(db);
  req.session.uid = u.id;
  req.session.meta = { ...requestMeta(req), createdAt: new Date().toISOString() };
  res.json({ user: safeUser(u) });
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 30);
  const password = String(req.body.password || '');
  const db = load();
  const u = db.users.find(x => x.username.toLowerCase() === username.toLowerCase());
  if (!u || !await bcrypt.compare(password, u.passwordHash)) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  if (u.banned) return res.status(403).json({ error: 'Tài khoản đã bị cấm' });
  u.lastSeen = new Date().toISOString();
  save(db);
  req.session.uid = u.id;
  req.session.meta = { ...requestMeta(req), createdAt: new Date().toISOString() };
  res.json({ user: safeUser(u) });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', auth, (req, res) => res.json({ user: safeUser(req.user) }));

app.post('/api/profile', auth, (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.user.id);
  u.displayName = cleanText(req.body.displayName || u.displayName, 40);
  u.bio = cleanText(req.body.bio, 300);
  u.games = cleanText(req.body.games, 160);
  u.gameId = cleanText(req.body.gameId, 100);
  u.discord = cleanText(req.body.discord, 100);
  save(db);
  res.json({ user: safeUser(u) });
});
app.post('/api/avatar', auth, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh' });
  const db = load();
  const u = db.users.find(x => x.id === req.user.id);
  u.avatar = '/uploads/' + req.file.filename;
  save(db);
  res.json({ user: safeUser(u) });
});
app.get('/api/members', auth, (req, res) => {
  const db = load();
  const now = Date.now();
  res.json({ members: db.users.filter(u => !u.banned).map(u => ({ ...safeUser(u), online: !!(u.lastSeen && now - new Date(u.lastSeen).getTime() < 5 * 60 * 1000) })) });
});
app.post('/api/ping', auth, (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.user.id);
  u.lastSeen = new Date().toISOString();
  save(db);
  res.json({ ok: true });
});

app.get('/api/music', auth, (req, res) => res.json({ music: load().music }));
app.post('/api/music', auth, (req, res) => {
  const url = cleanText(req.body.url, 1000);
  const title = cleanText(req.body.title || url, 100);
  try { new URL(url); } catch { return res.status(400).json({ error: 'Link không hợp lệ' }); }
  const db = load();
  if (!db.music.some(m => m.url === url)) db.music.push({ id: crypto.randomUUID(), title, url, addedBy: req.user.username, createdAt: new Date().toISOString() });
  save(db);
  res.json({ music: db.music });
});

app.get('/api/chat', auth, (req, res) => {
  const db = load();
  const room = cleanText(req.query.room || 'general', 40) || 'general';
  const messages = db.chat.filter(m => (m.room || 'general') === room).slice(-150).map(m => ({ ...m, mine: m.userId === req.user.id }));
  res.json({ room, messages });
});
app.post('/api/chat', auth, chatLimiter, (req, res) => {
  const text = cleanText(req.body.text, 500);
  const clientId = cleanText(req.body.clientId, 100);
  const room = cleanText(req.body.room || 'general', 40) || 'general';
  const replyTo = cleanText(req.body.replyTo, 80);
  if (!text) return res.status(400).json({ error: 'Tin nhắn trống' });
  const db = load();
  if (clientId) {
    const existing = db.chat.find(m => m.userId === req.user.id && m.clientId === clientId);
    if (existing) return res.json({ message: existing, deduplicated: true });
  }
  const replied = replyTo ? db.chat.find(m => m.id === replyTo && (m.room || 'general') === room) : null;
  const message = { id: crypto.randomUUID(), clientId: clientId || '', userId: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role, avatar: req.user.avatar || '', room, text, replyTo: replied ? replied.id : '', replyPreview: replied ? { displayName: replied.displayName, text: replied.text.slice(0, 100) } : null, reactions: {}, createdAt: new Date().toISOString() };
  db.chat.push(message);
  if (db.chat.length > 800) db.chat = db.chat.slice(-800);
  const mentioned = [...new Set((text.match(/@[a-zA-Z0-9_.-]{3,30}/g) || []).map(x => x.slice(1).toLowerCase()))];
  for (const username of mentioned) {
    const target = db.users.find(u => u.username.toLowerCase() === username && u.id !== req.user.id);
    if (target) notifyUser(db, target.id, 'mention', 'Bạn được nhắc trong trò chuyện', `${req.user.displayName}: ${text.slice(0, 140)}`, { route: 'chat', room });
  }
  if (replied && replied.userId !== req.user.id) notifyUser(db, replied.userId, 'reply', 'Có người trả lời tin nhắn của bạn', `${req.user.displayName}: ${text.slice(0, 140)}`, { route: 'chat', room });
  save(db);
  res.json({ message });
});
app.post('/api/chat/:id/reaction', auth, (req, res) => {
  const emoji = cleanText(req.body.emoji, 8);
  if (!['👍','❤️','😂','🔥','🎮'].includes(emoji)) return res.status(400).json({ error: 'Reaction không hợp lệ' });
  const db = load();
  const message = db.chat.find(m => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
  message.reactions = message.reactions || {};
  const list = new Set(message.reactions[emoji] || []);
  if (list.has(req.user.id)) list.delete(req.user.id); else list.add(req.user.id);
  message.reactions[emoji] = [...list];
  save(db);
  res.json({ reactions: message.reactions });
});
app.delete('/api/chat/:id', auth, (req, res) => {
  const db = load();
  const index = db.chat.findIndex(m => m.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
  const message = db.chat[index];
  const canDelete = message.userId === req.user.id || ['Boss', 'Kì Cựu'].includes(req.user.role);
  if (!canDelete) return res.status(403).json({ error: 'Không đủ quyền' });
  db.chat.splice(index, 1);
  addLog(db, 'chat_delete', { by: req.user.username, target: message.username });
  save(db);
  res.json({ ok: true });
});

app.get('/api/admin/users', auth, admin, (req, res) => res.json({ users: load().users.map(safeUser) }));
app.post('/api/admin/user/:id', auth, admin, (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy' });
  if (typeof req.body.banned === 'boolean') { u.banned = req.body.banned; if (!u.banned) notifyUser(db, u.id, 'account', 'Tài khoản đã được mở cấm', `Quản trị viên ${req.user.displayName} đã mở cấm tài khoản của bạn.`); }
  if (['Boss', 'Kì Cựu', 'Member'].includes(req.body.role) && req.user.role === 'Boss' && u.role !== req.body.role) { const oldRole = u.role; u.role = req.body.role; notifyUser(db, u.id, 'role', 'Role của bạn đã thay đổi', `${oldRole} → ${u.role}`, { route: 'profile' }); }
  addLog(db, 'admin_update', { target: u.username, by: req.user.username });
  save(db);
  res.json({ user: safeUser(u) });
});
app.post('/api/admin/user/:id/achievement', auth, admin, (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  const title = cleanText(req.body.title, 80);
  const description = cleanText(req.body.description, 180);
  const icon = cleanText(req.body.icon || '🏆', 8) || '🏆';
  if (!title) return res.status(400).json({ error: 'Chưa nhập tên thành tích' });
  u.achievements = Array.isArray(u.achievements) ? u.achievements : [];
  u.achievements.push({ id: crypto.randomUUID(), title, description, icon, awardedAt: new Date().toISOString(), awardedBy: req.user.username });
  notifyUser(db, u.id, 'achievement', 'Bạn có thành tích mới', `${icon} ${title}`, { route: 'profile' });
  addLog(db, 'achievement_add', { target: u.username, by: req.user.username });
  save(db);
  res.json({ user: safeUser(u) });
});
app.delete('/api/admin/user/:id/achievement/:achievementId', auth, admin, (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  u.achievements = (u.achievements || []).filter(a => a.id !== req.params.achievementId);
  addLog(db, 'achievement_remove', { target: u.username, by: req.user.username });
  save(db);
  res.json({ user: safeUser(u) });
});
app.get('/api/admin/logs', auth, admin, (req, res) => res.json({ logs: load().logs.slice(-100).reverse() }));
app.post('/api/backup', auth, admin, (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const f = path.join(backupDir, `db-${stamp}.json`);
  fs.copyFileSync(dbPath, f);
  res.json({ ok: true, file: path.basename(f) });
});


// ===== Notifications v1.4 =====
app.get('/api/notifications', auth, (req, res) => {
  const db = load();
  const items = db.notifications.filter(n => n.userId === req.user.id).slice(-100).reverse();
  res.json({ notifications: items, unread: items.filter(n => !n.read).length });
});
app.post('/api/notifications/read', auth, (req, res) => {
  const db = load();
  const id = cleanText(req.body.id, 80);
  for (const n of db.notifications) if (n.userId === req.user.id && (!id || n.id === id)) n.read = true;
  save(db); res.json({ ok: true });
});

// ===== Team Finder v1.4 =====
app.get('/api/team-posts', auth, (req, res) => {
  const db = load();
  const now = Date.now();
  for (const p of db.teamPosts) if (p.status === 'open' && p.expiresAt && new Date(p.expiresAt).getTime() <= now) p.status = 'expired';
  save(db);
  res.json({ posts: db.teamPosts.slice(-200).reverse().map(p => ({ ...p, mine: p.userId === req.user.id })) });
});
app.post('/api/team-posts', auth, (req, res) => {
  const db = load();
  const clientId = cleanText(req.body.clientId, 100);
  if (clientId) { const existing = db.teamPosts.find(p => p.userId === req.user.id && p.clientId === clientId); if (existing) return res.json({ post: existing, deduplicated: true }); }
  const game = cleanText(req.body.game, 60), mode = cleanText(req.body.mode, 80), server = cleanText(req.body.server, 80), playTime = cleanText(req.body.playTime, 80), note = cleanText(req.body.note, 280);
  const slots = Math.max(1, Math.min(20, Number(req.body.slots) || 1));
  const hours = Math.max(1, Math.min(168, Number(req.body.expireHours) || 24));
  if (!game) return res.status(400).json({ error: 'Chưa chọn game' });
  const post = { id: crypto.randomUUID(), clientId, userId: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role, avatar: req.user.avatar || '', game, mode, server, playTime, slots, note, status: 'open', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+hours*3600000).toISOString() };
  db.teamPosts.push(post); if (db.teamPosts.length > 500) db.teamPosts = db.teamPosts.slice(-500); save(db); res.json({ post });
});
app.post('/api/team-posts/:id/close', auth, (req, res) => {
  const db = load(); const p = db.teamPosts.find(x => x.id === req.params.id); if (!p) return res.status(404).json({ error: 'Không tìm thấy bài' });
  if (p.userId !== req.user.id && !['Boss','Kì Cựu'].includes(req.user.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  p.status = p.status === 'open' ? 'closed' : 'open'; save(db); res.json({ post: p });
});
app.delete('/api/team-posts/:id', auth, (req, res) => {
  const db = load(); const i = db.teamPosts.findIndex(x => x.id === req.params.id); if (i<0) return res.status(404).json({ error: 'Không tìm thấy bài' });
  const p=db.teamPosts[i]; if (p.userId !== req.user.id && !['Boss','Kì Cựu'].includes(req.user.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  db.teamPosts.splice(i,1); save(db); res.json({ ok:true });
});

// ===== Session & Security Center v1.4 =====
app.get('/api/security/sessions', auth, (req, res) => {
  const all = persistentSessionStore.readAll();
  const sessions = Object.entries(all).filter(([,sess]) => sess?.uid === req.user.id).map(([sid,sess]) => ({ id: sessionToken(sid), current: sid === req.sessionID, userAgent: sess.meta?.userAgent || 'Thiết bị không xác định', ip: sess.meta?.ip || '', createdAt: sess.meta?.createdAt || null, lastSeen: sess.meta?.lastSeen || null, expires: sess.cookie?.expires || null }));
  res.json({ sessions });
});
app.post('/api/security/sessions/:token/revoke', auth, (req, res) => {
  const all = persistentSessionStore.readAll();
  const entry = Object.entries(all).find(([sid,sess]) => sess?.uid === req.user.id && sessionToken(sid) === req.params.token);
  if (!entry) return res.status(404).json({ error: 'Không tìm thấy phiên' });
  if (entry[0] === req.sessionID) return res.status(400).json({ error: 'Dùng nút Đăng xuất để thoát phiên hiện tại' });
  persistentSessionStore.destroy(entry[0], err => err ? res.status(500).json({ error: 'Không thể đăng xuất thiết bị' }) : res.json({ ok:true }));
});
app.post('/api/security/password', auth, loginLimiter, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || ''), newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 8 ký tự' });
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); if (!u || !await bcrypt.compare(currentPassword,u.passwordHash)) return res.status(401).json({ error:'Mật khẩu hiện tại không đúng' });
  u.passwordHash=await bcrypt.hash(newPassword,12); addLog(db,'password_change',{user:u.username}); save(db);
  // revoke other sessions
  const all=persistentSessionStore.readAll(); for (const [sid,sess] of Object.entries(all)) if (sess?.uid===u.id && sid!==req.sessionID) delete all[sid]; persistentSessionStore.writeAll(all);
  res.json({ ok:true });
});

app.get('/api/tools/qr', auth, toolLimiter, async (req, res) => {
  const text = cleanText(req.query.text, 2000);
  const size = Math.min(1024, Math.max(128, Number(req.query.size) || 512));
  if (!text) return res.status(400).json({ error: 'Chưa nhập nội dung QR' });
  try {
    const png = await QRCode.toBuffer(text, { type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'no-store').send(png);
  } catch { res.status(500).json({ error: 'Không thể tạo QR' }); }
});

app.post('/api/tools/pdf/merge', auth, toolLimiter, memoryUpload.array('pdfs', 10), async (req, res) => {
  try {
    if (!req.files?.length || req.files.length < 2) return res.status(400).json({ error: 'Chọn ít nhất 2 file PDF' });
    const out = await PDFDocument.create();
    for (const file of req.files) {
      if (file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Chỉ chấp nhận file PDF' });
      const src = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    const bytes = await out.save({ useObjectStreams: true });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="giatoc-merged.pdf"' }).send(Buffer.from(bytes));
  } catch { res.status(400).json({ error: 'Không thể gộp các PDF này' }); }
});

app.post('/api/tools/pdf/images-to-pdf', auth, toolLimiter, memoryUpload.array('images', 20), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'Chưa chọn ảnh' });
    const out = await PDFDocument.create();
    for (const file of req.files) {
      let image;
      if (file.mimetype === 'image/png') image = await out.embedPng(file.buffer);
      else if (file.mimetype === 'image/jpeg') image = await out.embedJpg(file.buffer);
      else return res.status(400).json({ error: 'Chỉ hỗ trợ PNG/JPG khi chuyển sang PDF' });
      const page = out.addPage([595.28, 841.89]);
      const margin = 28;
      const maxW = page.getWidth() - margin * 2;
      const maxH = page.getHeight() - margin * 2;
      const scale = Math.min(maxW / image.width, maxH / image.height, 1);
      const w = image.width * scale, h = image.height * scale;
      page.drawImage(image, { x: (page.getWidth() - w) / 2, y: (page.getHeight() - h) / 2, width: w, height: h });
    }
    const bytes = await out.save({ useObjectStreams: true });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="giatoc-images.pdf"' }).send(Buffer.from(bytes));
  } catch { res.status(400).json({ error: 'Không thể chuyển ảnh sang PDF' }); }
});

app.post('/api/tools/pdf/compress', auth, toolLimiter, memoryUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file || req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Chọn một file PDF' });
    const src = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
    const optimized = Buffer.from(await src.save({ useObjectStreams: true, objectsPerTick: 50 }));
    const best = optimized.length < req.file.buffer.length ? optimized : req.file.buffer;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="giatoc-compressed.pdf"',
      'X-Original-Bytes': String(req.file.buffer.length),
      'X-Result-Bytes': String(best.length)
    }).send(best);
  } catch { res.status(400).json({ error: 'PDF bị khóa hoặc không thể tối ưu' }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GiaToc Name Hub v1.4.0 running on port ${PORT}`);
  console.log(`[Storage] ${storageRoot}`);
});
