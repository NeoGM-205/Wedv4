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
import webpush from 'web-push';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;
const APP_VERSION = '1.9.3';
const APP_NAME = 'GiaTộc ┊Name Hub';

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
const vapidKeyPath = path.join(storageRoot, 'vapid-keys.json');

function getVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    if (fs.existsSync(vapidKeyPath)) {
      const saved = JSON.parse(fs.readFileSync(vapidKeyPath, 'utf8'));
      if (saved?.publicKey && saved?.privateKey) return saved;
    }
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(vapidKeyPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
    return keys;
  } catch (error) {
    console.error('[Push] Không thể lưu VAPID key:', error.message);
    return webpush.generateVAPIDKeys();
  }
}
const vapidKeys = getVapidKeys();
const vapidSubject = process.env.VAPID_SUBJECT || process.env.PUBLIC_ORIGIN || 'https://giatoc-name-hub.robloxdatgaming.chatgpt.site';
webpush.setVapidDetails(vapidSubject, vapidKeys.publicKey, vapidKeys.privateKey);

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

const sessionSecret = getSessionSecret();

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
const DEFAULT_PERMISSION_MATRIX = {
  'Boss': { manageMembers:true, manageAchievements:true, manageReports:true, manageBackups:true, viewAnalytics:true, manageEvents:true, viewAudit:true, managePermissions:true },
  'Kì Cựu': { manageMembers:true, manageAchievements:true, manageReports:true, manageBackups:false, viewAnalytics:true, manageEvents:true, viewAudit:true, managePermissions:false },
  'Member': { manageMembers:false, manageAchievements:false, manageReports:false, manageBackups:false, viewAnalytics:false, manageEvents:false, viewAudit:false, managePermissions:false }
};
const DEFAULT_SYSTEM_SETTINGS = {
  registrationEnabled: true,
  chatCooldownMs: 1200,
  voiceMaxParticipants: 6,
  voiceMaxRooms: 20,
  cleanupIntervalHours: 6,
  logRetentionDays: 30,
  uploadOrphanDays: 7,
  storageWarningMb: 512
};
function normalizeSystemSettings(value={}) {
  const v={...DEFAULT_SYSTEM_SETTINGS,...(value||{})};
  v.registrationEnabled=!!v.registrationEnabled;
  v.chatCooldownMs=Math.max(500,Math.min(10000,Number(v.chatCooldownMs)||1200));
  v.voiceMaxParticipants=Math.max(2,Math.min(8,Number(v.voiceMaxParticipants)||6));
  v.voiceMaxRooms=Math.max(1,Math.min(100,Number(v.voiceMaxRooms)||20));
  v.cleanupIntervalHours=Math.max(1,Math.min(168,Number(v.cleanupIntervalHours)||6));
  v.logRetentionDays=Math.max(7,Math.min(365,Number(v.logRetentionDays)||30));
  v.uploadOrphanDays=Math.max(1,Math.min(90,Number(v.uploadOrphanDays)||7));
  v.storageWarningMb=Math.max(64,Math.min(10240,Number(v.storageWarningMb)||512));
  return v;
}
const defaultDb = { users: [], music: [], logs: [], chat: [], notifications: [], teamPosts: [], friendRequests: [], directMessages: [], reports: [], pushSubscriptions: [], events: [], achievementTemplates: [], permissionMatrix: structuredClone(DEFAULT_PERMISSION_MATRIX), systemSettings: structuredClone(DEFAULT_SYSTEM_SETTINGS), systemMeta: {} };
const normalizeDb = db => ({
  ...defaultDb, ...(db || {}),
  users: db?.users || [], music: db?.music || [], logs: db?.logs || [], chat: db?.chat || [],
  notifications: db?.notifications || [], teamPosts: db?.teamPosts || [], friendRequests: db?.friendRequests || [],
  directMessages: db?.directMessages || [], reports: db?.reports || [], pushSubscriptions: db?.pushSubscriptions || [], events: db?.events || [], achievementTemplates: db?.achievementTemplates || [], permissionMatrix: { ...structuredClone(DEFAULT_PERMISSION_MATRIX), ...(db?.permissionMatrix || {}) }, systemSettings: normalizeSystemSettings(db?.systemSettings), systemMeta: db?.systemMeta || {}
});
const load = () => { try { return normalizeDb(JSON.parse(fs.readFileSync(dbPath, 'utf8'))); } catch { return structuredClone(defaultDb); } };
const save = db => fs.writeFileSync(dbPath, JSON.stringify(normalizeDb(db), null, 2));
if (!fs.existsSync(dbPath)) save(defaultDb);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: persistentSessionStore,
  secret: sessionSecret,
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
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 10 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });
const toolLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const voiceLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false });
const chatCooldownByUser = new Map();

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
    achievements: Array.isArray(u.achievements) ? u.achievements : [],
    profileUpdatedAt: u.profileUpdatedAt || u.createdAt || null,
    muteUntil: u.muteUntil || null,
    muteReason: u.muteReason || '',
    xp: Number(u.xp || 0),
    level: levelFromXp(Number(u.xp || 0)),
    badges: Array.isArray(u.badges) ? u.badges : [],
    twoFactorEnabled: !!u.twoFactorEnabled,
    auraStatus: u.auraStatus || 'online',
    availabilityDays: Array.isArray(u.availabilityDays) ? u.availabilityDays : [],
    availabilityStart: u.availabilityStart || '',
    availabilityEnd: u.availabilityEnd || '',
    playStyle: u.playStyle || 'flex',
    prestige: Number(u.prestige || 0),
    toolbox: Array.isArray(u.toolbox) ? u.toolbox : ['chat','team','qr','avatar-tool'],
    highlights: Array.isArray(u.highlights) ? u.highlights.slice(-24) : [],
    notificationPrefs: normalizeNotificationPrefs(u.notificationPrefs)
  };
}


const DEFAULT_NOTIFICATION_PREFS = {
  pushEnabled:true, dm:true, mentions:true, friends:true, achievements:true, moderation:true, events:true, system:true,
  quietEnabled:false, quietStart:'22:00', quietEnd:'07:00', timezoneOffsetMinutes:420
};
function normalizeNotificationPrefs(value={}) {
  const v={...DEFAULT_NOTIFICATION_PREFS,...(value||{})};
  v.quietStart=/^([01]\d|2[0-3]):[0-5]\d$/.test(v.quietStart)?v.quietStart:'22:00';
  v.quietEnd=/^([01]\d|2[0-3]):[0-5]\d$/.test(v.quietEnd)?v.quietEnd:'07:00';
  v.timezoneOffsetMinutes=Math.max(-720,Math.min(840,Number(v.timezoneOffsetMinutes)||0));
  for (const k of ['pushEnabled','dm','mentions','friends','achievements','moderation','events','system','quietEnabled']) v[k]=!!v[k];
  return v;
}
function notificationCategory(type='system') {
  if (['dm','reply'].includes(type)) return 'dm';
  if (['mention'].includes(type)) return 'mentions';
  if (['friend'].includes(type)) return 'friends';
  if (['achievement','prestige','role'].includes(type)) return 'achievements';
  if (['moderation','account'].includes(type)) return 'moderation';
  if (['event'].includes(type)) return 'events';
  return 'system';
}
function isQuietNow(prefs) {
  if (!prefs.quietEnabled) return false;
  const localMs=Date.now()+prefs.timezoneOffsetMinutes*60000;
  const d=new Date(localMs), cur=d.getUTCHours()*60+d.getUTCMinutes();
  const [sh,sm]=prefs.quietStart.split(':').map(Number), [eh,em]=prefs.quietEnd.split(':').map(Number);
  const start=sh*60+sm,end=eh*60+em;
  return start===end ? true : start<end ? cur>=start&&cur<end : cur>=start||cur<end;
}

function levelFromXp(xp) { return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1); }
const BADGE_RULES = [
  { id:'starter', icon:'🌱', name:'Khởi đầu', xp:25 },
  { id:'active', icon:'⚡', name:'Thành viên năng động', xp:150 },
  { id:'veteran', icon:'🏅', name:'Cống hiến', xp:500 },
  { id:'legend', icon:'👑', name:'Huyền thoại cộng đồng', xp:1200 }
];
function syncBadges(user) {
  user.badges = Array.isArray(user.badges) ? user.badges : [];
  for (const rule of BADGE_RULES) if ((user.xp || 0) >= rule.xp && !user.badges.some(b => b.id === rule.id)) user.badges.push({ ...rule, awardedAt:new Date().toISOString() });
}
function addXp(user, amount, reason, cooldownMs = 0) {
  user.xpMeta = user.xpMeta || {};
  const now = Date.now(); const last = Number(user.xpMeta[reason] || 0);
  if (cooldownMs && now - last < cooldownMs) return 0;
  const add = Math.max(0, Math.min(100, Number(amount) || 0));
  user.xp = Number(user.xp || 0) + add; user.xpMeta[reason] = now; syncBadges(user); return add;
}
const BASE32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function randomBase32(len=32){ const bytes=crypto.randomBytes(len); let out=''; for(let i=0;i<len;i++) out+=BASE32[bytes[i]%32]; return out; }
function base32Decode(input){ const clean=String(input||'').toUpperCase().replace(/[^A-Z2-7]/g,''); let bits=''; for(const c of clean) bits+=BASE32.indexOf(c).toString(2).padStart(5,'0'); const arr=[]; for(let i=0;i+8<=bits.length;i+=8) arr.push(parseInt(bits.slice(i,i+8),2)); return Buffer.from(arr); }
function hotp(secret,counter){ const key=base32Decode(secret); const buf=Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter)); const h=crypto.createHmac('sha1',key).update(buf).digest(); const off=h[h.length-1]&15; const n=(h.readUInt32BE(off)&0x7fffffff)%1000000; return String(n).padStart(6,'0'); }
function verifyTotp(secret, code){ const clean=String(code||'').replace(/\s/g,''); if(!/^\d{6}$/.test(clean)) return false; const ctr=Math.floor(Date.now()/30000); return [-1,0,1].some(w=>hotp(secret,ctr+w)===clean); }
function makeRecoveryCodes(){ return Array.from({length:8},()=>crypto.randomBytes(4).toString('hex').toUpperCase()); }
function hashRecovery(code){ return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex'); }

function auth(req, res, next) {
  const db = load();
  const u = db.users.find(x => x.id === req.session.uid);
  if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
  if (u.banned) return res.status(403).json({ error: 'Tài khoản đã bị cấm' });
  req.user = u;
  req.session.meta = { ...(req.session.meta || {}), ...requestMeta(req), createdAt: req.session.meta?.createdAt || new Date().toISOString() };
  next();
}
function permissionMatrix(db) {
  const raw=db?.permissionMatrix || {};
  const out=structuredClone(DEFAULT_PERMISSION_MATRIX);
  for (const role of Object.keys(out)) out[role]={...out[role],...(raw[role]||{})};
  return out;
}
function hasPermission(user, db, key) {
  if (user?.role === 'Boss') return true;
  return !!permissionMatrix(db)[user?.role]?.[key];
}
function admin(req, res, next) {
  if (!['Boss', 'Kì Cựu'].includes(req.user.role)) return res.status(403).json({ error: 'Không đủ quyền' });
  next();
}
function requirePermission(key) {
  return (req,res,next)=>{ const db=load(); if(!hasPermission(req.user,db,key)) return res.status(403).json({error:`Bạn không có quyền: ${key}`}); req.permissions=permissionMatrix(db)[req.user.role]||{}; next(); };
}
function bossOnly(req,res,next){ if(req.user.role!=='Boss') return res.status(403).json({error:'Chỉ Boss được phép thực hiện thao tác này'}); next(); }
function addLog(db, action, extra = {}) {
  const category = extra.category || (action.startsWith('backup')?'backup':action.includes('report')||action.includes('mute')||action.includes('ban')?'moderation':action.includes('achievement')?'achievement':action.includes('event')?'event':action.includes('permission')?'security':action.includes('2fa')||action.includes('password')||action.includes('session')?'security':'system');
  db.logs.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, category, ...extra });
  if (db.logs.length > 5000) db.logs = db.logs.slice(-5000);
}
function notifyUser(db, userId, type, title, message, extra = {}) {
  if (!userId) return;
  const notification = { id: crypto.randomUUID(), userId, type, title: cleanText(title, 100), message: cleanText(message, 240), read: false, createdAt: new Date().toISOString(), ...extra };
  db.notifications.push(notification);
  if (db.notifications.length > 2000) db.notifications = db.notifications.slice(-2000);
  setImmediate(() => sendPushToUser(userId, { type, title: notification.title, body: notification.message, route: notification.route || 'notifications', room: notification.room || '', dmUserId: notification.dmUserId || '' }).catch(()=>{}));
}
function sessionToken(sid) { return crypto.createHash('sha256').update(sid).digest('hex').slice(0, 20); }
function requestMeta(req) { return { userAgent: cleanText(req.get('user-agent') || 'Thiết bị không xác định', 180), ip: cleanText(req.ip || '', 80), lastSeen: new Date().toISOString() }; }
function isMuted(user) { return !!(user?.muteUntil && new Date(user.muteUntil).getTime() > Date.now()); }
function ensureCanCommunicate(user, res) {
  if (!isMuted(user)) return true;
  res.status(403).json({ error: `Bạn đang bị tạm hạn chế đến ${new Date(user.muteUntil).toLocaleString('vi-VN')}${user.muteReason ? ` • ${user.muteReason}` : ''}` });
  return false;
}
function areFriends(db, a, b) {
  return db.friendRequests.some(r => r.status === 'accepted' && ((r.fromUserId === a && r.toUserId === b) || (r.fromUserId === b && r.toUserId === a)));
}
function backupNameSafe(name) { return /^db-[0-9T-]+Z?\.json$/i.test(String(name || '')) ? path.basename(String(name)) : ''; }
function createBackupFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `db-${stamp}.json`);
  fs.copyFileSync(dbPath, file);
  const keep = Math.max(5, Math.min(100, Number(process.env.BACKUP_KEEP || 30)));
  const files = fs.readdirSync(backupDir).filter(f => /^db-.*\.json$/i.test(f)).map(f => ({ f, t: fs.statSync(path.join(backupDir, f)).mtimeMs })).sort((a,b)=>b.t-a.t);
  for (const old of files.slice(keep)) { try { fs.unlinkSync(path.join(backupDir, old.f)); } catch {} }
  return path.basename(file);
}
async function sendPushToUser(userId, payload = {}) {
  const db = load();
  const user=db.users.find(u=>u.id===userId);
  const prefs=normalizeNotificationPrefs(user?.notificationPrefs);
  const category=notificationCategory(payload.type);
  if (!prefs.pushEnabled || prefs[category] === false || isQuietNow(prefs)) return;
  const subs = db.pushSubscriptions.filter(s => s.userId === userId);
  if (!subs.length) return;
  const stale = new Set();
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: sub.keys }, JSON.stringify(payload), { TTL: 60 * 60 * 12 });
    } catch (error) {
      if ([404, 410].includes(error?.statusCode)) stale.add(sub.endpoint);
      else console.warn('[Push] send failed:', error?.statusCode || error?.message || error);
    }
  }));
  if (stale.size) {
    db.pushSubscriptions = db.pushSubscriptions.filter(s => !stale.has(s.endpoint));
    save(db);
  }
}

app.get('/api/health', (req, res) => res.json({
  ok: true,
  version: APP_VERSION,
  storage: { root: storageRoot, data: dataDir, uploads: uploadDir, backups: backupDir }
}));

app.post('/api/register', registerLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 30);
  const password = String(req.body.password || '');
  const displayName = cleanText(req.body.displayName || username, 40);
  if (!username || !password || username.length < 3 || password.length < 6) return res.status(400).json({ error: 'Thông tin chưa hợp lệ' });
  const db = load();
  if (!db.systemSettings.registrationEnabled && db.users.length > 0) return res.status(403).json({ error: 'Hệ thống đang tạm khóa đăng ký tài khoản mới' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
  const first = db.users.length === 0;
  const u = {
    id: crypto.randomUUID(), username, displayName, passwordHash: await bcrypt.hash(password, 12), role: first ? 'Boss' : 'Member', avatar: '', banned: false,
    bio: '', games: '', gameId: '', discord: '', achievements: [], badges: [], xp: 0, xpMeta: {}, prestige: 0,
    auraStatus: 'online', availabilityDays: [], availabilityStart: '', availabilityEnd: '', playStyle: 'flex', toolbox: ['chat','team','qr','avatar-tool'], highlights: [],
    twoFactorEnabled: false, twoFactorSecret: '', twoFactorPendingSecret: '', recoveryCodeHashes: [], notificationPrefs: structuredClone(DEFAULT_NOTIFICATION_PREFS), muteUntil: null, muteReason: '', createdAt: new Date().toISOString(), profileUpdatedAt: new Date().toISOString(), lastSeen: new Date().toISOString()
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
  if (u.twoFactorEnabled) {
    const code = String(req.body.totp || '').trim();
    let accepted = verifyTotp(u.twoFactorSecret, code);
    if (!accepted && code) {
      const h = hashRecovery(code); const idx=(u.recoveryCodeHashes||[]).indexOf(h);
      if (idx >= 0) { accepted=true; u.recoveryCodeHashes.splice(idx,1); }
    }
    if (!accepted) return res.status(428).json({ error:'Cần mã xác thực 2 bước', twoFactorRequired:true });
  }
  u.lastSeen = new Date().toISOString(); addXp(u, 2, 'daily_login', 20*60*60*1000);
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
  const baseUpdatedAt = cleanText(req.body.baseUpdatedAt, 80);
  if (!req.body.force && baseUpdatedAt && u.profileUpdatedAt && baseUpdatedAt !== u.profileUpdatedAt) {
    return res.status(409).json({ error: 'Hồ sơ đã thay đổi trên máy chủ trong lúc bạn offline.', conflict: true, current: safeUser(u) });
  }
  u.displayName = cleanText(req.body.displayName || u.displayName, 40);
  u.bio = cleanText(req.body.bio, 300);
  u.games = cleanText(req.body.games, 160);
  u.gameId = cleanText(req.body.gameId, 100);
  u.discord = cleanText(req.body.discord, 100);
  const allowedAura = new Set(['online','looking','busy','event','chill']);
  const auraStatus = cleanText(req.body.auraStatus, 20); if (allowedAura.has(auraStatus)) u.auraStatus = auraStatus;
  const allowedStyles = new Set(['flex','chill','competitive','voice','quiet']);
  const playStyle = cleanText(req.body.playStyle, 20); if (allowedStyles.has(playStyle)) u.playStyle = playStyle;
  u.availabilityStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body.availabilityStart||'')) ? String(req.body.availabilityStart) : '';
  u.availabilityEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body.availabilityEnd||'')) ? String(req.body.availabilityEnd) : '';
  u.availabilityDays = Array.isArray(req.body.availabilityDays) ? req.body.availabilityDays.map(x=>Number(x)).filter(x=>Number.isInteger(x)&&x>=0&&x<=6).slice(0,7) : (u.availabilityDays||[]);
  if (Array.isArray(req.body.toolbox)) u.toolbox = [...new Set(req.body.toolbox.map(x=>cleanText(x,30)).filter(Boolean))].slice(0,6);
  u.profileUpdatedAt = new Date().toISOString();
  save(db);
  res.json({ user: safeUser(u) });
});
app.post('/api/avatar', auth, uploadLimiter, avatarUpload.single('avatar'), (req, res) => {
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
  const q = cleanText(req.query.q || '', 80).toLowerCase();
  let rows = db.chat.filter(m => (m.room || 'general') === room);
  if (q) rows = rows.filter(m => String(m.text||'').toLowerCase().includes(q) || String(m.displayName||'').toLowerCase().includes(q));
  const messages = rows.slice(-150).map(m => ({ ...m, mine: m.userId === req.user.id }));
  const pinned = db.chat.filter(m => (m.room || 'general') === room && m.pinned).slice(-10).map(m => ({...m,mine:m.userId===req.user.id}));
  res.json({ room, messages, pinned });
});
app.post('/api/chat', auth, chatLimiter, (req, res) => {
  if (!ensureCanCommunicate(req.user, res)) return;
  const chatSettings = load().systemSettings;
  const nowChat = Date.now();
  const lastChat = chatCooldownByUser.get(req.user.id) || 0;
  if (nowChat - lastChat < chatSettings.chatCooldownMs) return res.status(429).json({ error: `Gửi quá nhanh. Vui lòng chờ ${Math.ceil((chatSettings.chatCooldownMs - (nowChat-lastChat))/1000)} giây.` });
  chatCooldownByUser.set(req.user.id, nowChat);
  const text = cleanText(req.body.text, 500);
  const clientId = cleanText(req.body.clientId, 100);
  const room = cleanText(req.body.room || 'general', 40) || 'general';
  const replyTo = cleanText(req.body.replyTo, 80);
  const attachmentUrl = cleanText(req.body.attachmentUrl, 300);
  if (!text && !attachmentUrl) return res.status(400).json({ error: 'Tin nhắn trống' });
  const db = load();
  if (clientId) {
    const existing = db.chat.find(m => m.userId === req.user.id && m.clientId === clientId);
    if (existing) return res.json({ message: existing, deduplicated: true });
  }
  const replied = replyTo ? db.chat.find(m => m.id === replyTo && (m.room || 'general') === room) : null;
  const message = { id: crypto.randomUUID(), clientId: clientId || '', userId: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role, avatar: req.user.avatar || '', room, text, attachmentUrl, editedAt:'', pinned:false, pinnedBy:'', replyTo: replied ? replied.id : '', replyPreview: replied ? { displayName: replied.displayName, text: replied.text.slice(0, 100) } : null, reactions: {}, createdAt: new Date().toISOString() };
  db.chat.push(message);
  if (db.chat.length > 800) db.chat = db.chat.slice(-800);
  const mentioned = [...new Set((text.match(/@[a-zA-Z0-9_.-]{3,30}/g) || []).map(x => x.slice(1).toLowerCase()))];
  for (const username of mentioned) {
    const target = db.users.find(u => u.username.toLowerCase() === username && u.id !== req.user.id);
    if (target) notifyUser(db, target.id, 'mention', 'Bạn được nhắc trong trò chuyện', `${req.user.displayName}: ${text.slice(0, 140)}`, { route: 'chat', room });
  }
  addXp(db.users.find(u=>u.id===req.user.id), 3, 'chat_xp', 60*1000);
  if (replied && replied.userId !== req.user.id) notifyUser(db, replied.userId, 'reply', 'Có người trả lời tin nhắn của bạn', `${req.user.displayName}: ${text.slice(0, 140)}`, { route: 'chat', room });
  save(db);
  res.json({ message });
});

const chatImageUpload = multer({ storage: diskStorage, limits:{fileSize:3*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) });
app.post('/api/chat/upload', auth, uploadLimiter, chatImageUpload.single('image'), (req,res)=>{
  if (!ensureCanCommunicate(req.user,res)) return;
  if(!req.file) return res.status(400).json({error:'Chỉ hỗ trợ ảnh PNG/JPG/WebP/GIF tối đa 3MB'});
  res.json({url:'/uploads/'+req.file.filename});
});
app.patch('/api/chat/:id', auth, (req,res)=>{
  const text=cleanText(req.body.text,500); if(!text) return res.status(400).json({error:'Tin nhắn trống'});
  const db=load(); const m=db.chat.find(x=>x.id===req.params.id); if(!m) return res.status(404).json({error:'Không tìm thấy tin nhắn'});
  if(m.userId!==req.user.id) return res.status(403).json({error:'Chỉ được sửa tin nhắn của bạn'});
  if(Date.now()-new Date(m.createdAt).getTime()>30*60*1000) return res.status(400).json({error:'Chỉ sửa được tin trong 30 phút'});
  m.text=text; m.editedAt=new Date().toISOString(); save(db); res.json({message:m});
});
app.post('/api/chat/:id/pin', auth, admin, (req,res)=>{
  const db=load(); const m=db.chat.find(x=>x.id===req.params.id); if(!m) return res.status(404).json({error:'Không tìm thấy tin nhắn'});
  m.pinned=!m.pinned; m.pinnedBy=m.pinned?req.user.username:''; addLog(db,m.pinned?'chat_pin':'chat_unpin',{by:req.user.username,message:m.id}); save(db); res.json({message:m});
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

app.get('/api/admin/users', auth, admin, requirePermission('manageMembers'), (req, res) => res.json({ users: load().users.map(safeUser) }));
app.post('/api/admin/user/:id', auth, admin, requirePermission('manageMembers'), (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy' });
  if (typeof req.body.banned === 'boolean') { u.banned = req.body.banned; if (!u.banned) notifyUser(db, u.id, 'account', 'Tài khoản đã được mở cấm', `Quản trị viên ${req.user.displayName} đã mở cấm tài khoản của bạn.`); }
  if (['Boss', 'Kì Cựu', 'Member'].includes(req.body.role) && req.user.role === 'Boss' && u.role !== req.body.role) { const oldRole = u.role; u.role = req.body.role; notifyUser(db, u.id, 'role', 'Role của bạn đã thay đổi', `${oldRole} → ${u.role}`, { route: 'profile' }); }
  addLog(db, 'admin_update', { target: u.username, by: req.user.username });
  save(db);
  res.json({ user: safeUser(u) });
});
app.post('/api/admin/user/:id/achievement', auth, admin, requirePermission('manageAchievements'), (req, res) => {
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
app.delete('/api/admin/user/:id/achievement/:achievementId', auth, admin, requirePermission('manageAchievements'), (req, res) => {
  const db = load();
  const u = db.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  u.achievements = (u.achievements || []).filter(a => a.id !== req.params.achievementId);
  addLog(db, 'achievement_remove', { target: u.username, by: req.user.username });
  save(db);
  res.json({ user: safeUser(u) });
});
app.get('/api/admin/logs', auth, admin, requirePermission('viewAudit'), (req, res) => res.json({ logs: load().logs.slice(-100).reverse() }));
app.post('/api/backup', auth, admin, requirePermission('manageBackups'), (req, res) => {
  const file = createBackupFile();
  const db = load(); addLog(db, 'backup_create', { by: req.user.username, file }); save(db);
  res.json({ ok: true, file });
});
app.get('/api/backups', auth, admin, requirePermission('manageBackups'), (req, res) => {
  const backups = fs.readdirSync(backupDir).filter(f => /^db-.*\.json$/i.test(f)).map(file => {
    const st = fs.statSync(path.join(backupDir, file));
    return { file, size: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ backups, autoHours: Math.max(1, Number(process.env.AUTO_BACKUP_HOURS || 6)), keep: Math.max(5, Number(process.env.BACKUP_KEEP || 30)) });
});
app.post('/api/backups/:file/restore', auth, admin, requirePermission('manageBackups'), loginLimiter, async (req, res) => {
  const file = backupNameSafe(req.params.file); if (!file) return res.status(400).json({ error: 'Tên backup không hợp lệ' });
  const db = load(); const actor = db.users.find(u => u.id === req.user.id);
  if (!actor || !await bcrypt.compare(String(req.body.password || ''), actor.passwordHash)) return res.status(401).json({ error: 'Mật khẩu xác nhận không đúng' });
  const full = path.join(backupDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: 'Không tìm thấy backup' });
  try {
    const restored = normalizeDb(JSON.parse(fs.readFileSync(full, 'utf8')));
    const safety = createBackupFile();
    fs.writeFileSync(dbPath, JSON.stringify(restored, null, 2));
    const after = load(); addLog(after, 'backup_restore', { by: req.user.username, file, safety }); save(after);
    res.json({ ok: true, restored: file, safetyBackup: safety });
  } catch { res.status(400).json({ error: 'Backup bị lỗi hoặc không đọc được' }); }
});
app.delete('/api/backups/:file', auth, admin, requirePermission('manageBackups'), (req, res) => {
  const file = backupNameSafe(req.params.file); if (!file) return res.status(400).json({ error: 'Tên backup không hợp lệ' });
  const full = path.join(backupDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: 'Không tìm thấy backup' });
  fs.unlinkSync(full); const db = load(); addLog(db, 'backup_delete', { by: req.user.username, file }); save(db); res.json({ ok: true });
});

// ===== Push Notifications v1.5 =====
app.get('/api/push/vapid-public-key', auth, (req, res) => res.json({ publicKey: vapidKeys.publicKey }));
app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: 'Push subscription không hợp lệ' });
  const db = load();
  db.pushSubscriptions = db.pushSubscriptions.filter(x => x.endpoint !== sub.endpoint);
  db.pushSubscriptions.push({ id: crypto.randomUUID(), userId: req.user.id, endpoint: sub.endpoint, expirationTime: sub.expirationTime || null, keys: sub.keys, userAgent: cleanText(req.get('user-agent'), 180), createdAt: new Date().toISOString() });
  save(db); res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => {
  const endpoint = cleanText(req.body?.endpoint, 2000); const db = load();
  db.pushSubscriptions = db.pushSubscriptions.filter(s => !(s.userId === req.user.id && (!endpoint || s.endpoint === endpoint)));
  save(db); res.json({ ok: true });
});

// ===== Friends & Direct Messages v1.5 =====
app.get('/api/friends', auth, (req, res) => {
  const db = load();
  const accepted = db.friendRequests.filter(r => r.status === 'accepted' && (r.fromUserId === req.user.id || r.toUserId === req.user.id));
  const friendIds = accepted.map(r => r.fromUserId === req.user.id ? r.toUserId : r.fromUserId);
  const friends = friendIds.map(id => db.users.find(u => u.id === id)).filter(Boolean).map(safeUser);
  const incoming = db.friendRequests.filter(r => r.status === 'pending' && r.toUserId === req.user.id).map(r => ({ ...r, user: safeUser(db.users.find(u => u.id === r.fromUserId) || {}) }));
  const outgoing = db.friendRequests.filter(r => r.status === 'pending' && r.fromUserId === req.user.id).map(r => ({ ...r, user: safeUser(db.users.find(u => u.id === r.toUserId) || {}) }));
  res.json({ friends, incoming, outgoing });
});
app.post('/api/friends/request/:id', auth, (req, res) => {
  const targetId = req.params.id; if (targetId === req.user.id) return res.status(400).json({ error: 'Không thể kết bạn với chính mình' });
  const db = load(); const target = db.users.find(u => u.id === targetId && !u.banned); if (!target) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  const existing = db.friendRequests.find(r => (r.fromUserId === req.user.id && r.toUserId === targetId) || (r.fromUserId === targetId && r.toUserId === req.user.id));
  if (existing?.status === 'accepted') return res.status(409).json({ error: 'Hai bạn đã là bạn bè' });
  if (existing?.status === 'pending') {
    if (existing.toUserId === req.user.id) { existing.status = 'accepted'; existing.acceptedAt = new Date().toISOString(); notifyUser(db, targetId, 'friend', 'Lời mời kết bạn đã được chấp nhận', `${req.user.displayName} đã chấp nhận lời mời kết bạn.`, { route: 'friends' }); save(db); return res.json({ request: existing, accepted: true }); }
    return res.status(409).json({ error: 'Lời mời đã được gửi' });
  }
  const request = { id: crypto.randomUUID(), fromUserId: req.user.id, toUserId: targetId, status: 'pending', createdAt: new Date().toISOString() };
  db.friendRequests.push(request); notifyUser(db, targetId, 'friend', 'Bạn có lời mời kết bạn', `${req.user.displayName} muốn kết bạn với bạn.`, { route: 'friends' }); save(db); res.json({ request });
});
app.post('/api/friends/request/:id/accept', auth, (req, res) => {
  const db = load(); const request = db.friendRequests.find(r => r.id === req.params.id && r.toUserId === req.user.id && r.status === 'pending');
  if (!request) return res.status(404).json({ error: 'Không tìm thấy lời mời' });
  request.status = 'accepted'; request.acceptedAt = new Date().toISOString();
  notifyUser(db, request.fromUserId, 'friend', 'Lời mời kết bạn đã được chấp nhận', `${req.user.displayName} đã chấp nhận lời mời kết bạn.`, { route: 'friends' }); save(db); res.json({ ok: true });
});
app.delete('/api/friends/request/:id', auth, (req, res) => {
  const db = load(); const i = db.friendRequests.findIndex(r => r.id === req.params.id && r.status === 'pending' && (r.fromUserId === req.user.id || r.toUserId === req.user.id));
  if (i < 0) return res.status(404).json({ error: 'Không tìm thấy lời mời' }); db.friendRequests.splice(i, 1); save(db); res.json({ ok: true });
});
app.delete('/api/friends/:id', auth, (req, res) => {
  const db = load(); const before = db.friendRequests.length;
  db.friendRequests = db.friendRequests.filter(r => !(r.status === 'accepted' && ((r.fromUserId === req.user.id && r.toUserId === req.params.id) || (r.fromUserId === req.params.id && r.toUserId === req.user.id))));
  if (db.friendRequests.length === before) return res.status(404).json({ error: 'Không tìm thấy bạn bè' }); save(db); res.json({ ok: true });
});
app.get('/api/dm/:userId', auth, (req, res) => {
  const db = load(); if (!areFriends(db, req.user.id, req.params.userId)) return res.status(403).json({ error: 'Chỉ có thể nhắn tin cho bạn bè' });
  const messages = db.directMessages.filter(m => (m.userId === req.user.id && m.toUserId === req.params.userId) || (m.userId === req.params.userId && m.toUserId === req.user.id)).slice(-200);
  for (const m of messages) { m.readBy = Array.isArray(m.readBy) ? m.readBy : []; if (m.toUserId === req.user.id && !m.readBy.includes(req.user.id)) m.readBy.push(req.user.id); }
  save(db); res.json({ messages: messages.map(m => ({ ...m, mine: m.userId === req.user.id })) });
});
app.post('/api/dm/:userId', auth, chatLimiter, (req, res) => {
  if (!ensureCanCommunicate(req.user, res)) return;
  const db = load(); if (!areFriends(db, req.user.id, req.params.userId)) return res.status(403).json({ error: 'Chỉ có thể nhắn tin cho bạn bè' });
  const target = db.users.find(u => u.id === req.params.userId && !u.banned); if (!target) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  const text = cleanText(req.body.text, 500), clientId = cleanText(req.body.clientId, 100); if (!text) return res.status(400).json({ error: 'Tin nhắn trống' });
  if (clientId) { const old = db.directMessages.find(m => m.userId === req.user.id && m.clientId === clientId); if (old) return res.json({ message: old, deduplicated: true }); }
  const message = { id: crypto.randomUUID(), clientId, userId: req.user.id, toUserId: target.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role, avatar: req.user.avatar || '', text, readBy: [req.user.id], createdAt: new Date().toISOString() };
  db.directMessages.push(message); if (db.directMessages.length > 3000) db.directMessages = db.directMessages.slice(-3000);
  notifyUser(db, target.id, 'dm', 'Tin nhắn mới', `${req.user.displayName}: ${text.slice(0, 140)}`, { route: 'friends', dmUserId: req.user.id }); save(db); res.json({ message });
});

// ===== Reports & Moderation v1.5 =====
app.post('/api/reports', auth, (req, res) => {
  const targetType = cleanText(req.body.targetType, 30), targetId = cleanText(req.body.targetId, 100), reason = cleanText(req.body.reason, 400);
  if (!['user','chat','team','dm'].includes(targetType) || !targetId || reason.length < 3) return res.status(400).json({ error: 'Báo cáo chưa hợp lệ' });
  const db = load(); const report = { id: crypto.randomUUID(), reporterId: req.user.id, reporterUsername: req.user.username, targetType, targetId, reason, status: 'open', assignedTo:'', internalNote:'', history:[], createdAt: new Date().toISOString(), updatedAt:new Date().toISOString() };
  db.reports.push(report); if (db.reports.length > 1000) db.reports = db.reports.slice(-1000); addLog(db, 'report_create', { by: req.user.username, targetType, targetId }); save(db); res.json({ report });
});
app.get('/api/admin/reports', auth, admin, requirePermission('manageReports'), (req, res) => res.json({ reports: load().reports.slice(-300).reverse() }));
app.post('/api/admin/reports/:id/resolve', auth, admin, requirePermission('manageReports'), (req, res) => {
  const db = load(); const report = db.reports.find(r => r.id === req.params.id); if (!report) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
  report.status = cleanText(req.body.status, 20) === 'dismissed' ? 'dismissed' : 'resolved'; report.resolvedAt = new Date().toISOString(); report.updatedAt=report.resolvedAt; report.resolvedBy = req.user.username; report.assignedTo=report.assignedTo||req.user.username; report.history=Array.isArray(report.history)?report.history:[]; report.history.push({at:report.resolvedAt,by:req.user.username,status:report.status,note:report.internalNote||''}); addLog(db, 'report_resolve', { by: req.user.username, report: report.id, status: report.status }); save(db); res.json({ report });
});
app.post('/api/admin/user/:id/mute', auth, admin, requirePermission('manageMembers'), (req, res) => {
  const db = load(); const target = db.users.find(u => u.id === req.params.id); if (!target) return res.status(404).json({ error: 'Không tìm thấy thành viên' });
  if (req.user.role !== 'Boss' && target.role === 'Boss') return res.status(403).json({ error: 'Kì Cựu không thể hạn chế Boss' });
  const minutes = Math.max(0, Math.min(10080, Number(req.body.minutes) || 0)); const reason = cleanText(req.body.reason, 200);
  target.muteUntil = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null; target.muteReason = minutes ? reason : '';
  notifyUser(db, target.id, 'moderation', minutes ? 'Tài khoản bị tạm hạn chế' : 'Đã gỡ hạn chế', minutes ? `Bạn bị hạn chế chat/tìm đội trong ${minutes} phút${reason ? ` • ${reason}` : ''}` : 'Quản trị viên đã gỡ hạn chế giao tiếp.', { route: 'profile' });
  addLog(db, minutes ? 'user_mute' : 'user_unmute', { by: req.user.username, target: target.username, minutes, reason }); save(db); res.json({ user: safeUser(target) });
});

// ===== Notifications v1.5 =====
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

// ===== Team Finder v1.5 =====
app.get('/api/team-posts', auth, (req, res) => {
  const db = load();
  const now = Date.now();
  for (const p of db.teamPosts) if (p.status === 'open' && p.expiresAt && new Date(p.expiresAt).getTime() <= now) p.status = 'expired';
  save(db);
  res.json({ posts: db.teamPosts.slice(-200).reverse().map(p => ({ ...p, mine: p.userId === req.user.id })) });
});
app.post('/api/team-posts', auth, (req, res) => {
  if (!ensureCanCommunicate(req.user, res)) return;
  const db = load();
  const clientId = cleanText(req.body.clientId, 100);
  if (clientId) { const existing = db.teamPosts.find(p => p.userId === req.user.id && p.clientId === clientId); if (existing) return res.json({ post: existing, deduplicated: true }); }
  const game = cleanText(req.body.game, 60), mode = cleanText(req.body.mode, 80), server = cleanText(req.body.server, 80), playTime = cleanText(req.body.playTime, 80), note = cleanText(req.body.note, 280);
  const slots = Math.max(1, Math.min(20, Number(req.body.slots) || 1));
  const hours = Math.max(1, Math.min(168, Number(req.body.expireHours) || 24));
  if (!game) return res.status(400).json({ error: 'Chưa chọn game' });
  const post = { id: crypto.randomUUID(), clientId, userId: req.user.id, username: req.user.username, displayName: req.user.displayName, role: req.user.role, avatar: req.user.avatar || '', game, mode, server, playTime, slots, note, status: 'open', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+hours*3600000).toISOString() };
  db.teamPosts.push(post); if (db.teamPosts.length > 500) db.teamPosts = db.teamPosts.slice(-500); addXp(db.users.find(u=>u.id===req.user.id), 8, 'team_post', 6*60*60*1000); save(db); res.json({ post });
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


// ===== v1.6 Auto Match, Events, XP/Badges, Analytics =====
app.post('/api/team-match', auth, (req,res)=>{
  const db=load();
  const game=cleanText(req.body.game,60).toLowerCase(), mode=cleanText(req.body.mode,80).toLowerCase(), server=cleanText(req.body.server,80).toLowerCase(), playTime=cleanText(req.body.playTime,80).toLowerCase();
  const style=cleanText(req.body.playStyle || req.user.playStyle,30).toLowerCase();
  const days=Array.isArray(req.body.availabilityDays)?req.body.availabilityDays.map(Number).filter(x=>x>=0&&x<=6):(req.user.availabilityDays||[]);
  const now=Date.now();
  const matches=db.teamPosts.filter(p=>p.userId!==req.user.id && p.status==='open' && (!p.expiresAt || new Date(p.expiresAt).getTime()>now)).map(p=>{
    const owner=db.users.find(u=>u.id===p.userId)||{}; let score=0; const reasons=[];
    if(game && p.game?.toLowerCase()===game){score+=40;reasons.push('Cùng game');}
    if(mode && p.mode?.toLowerCase().includes(mode)){score+=15;reasons.push('Cùng chế độ');}
    if(server && p.server?.toLowerCase().includes(server)){score+=10;reasons.push('Cùng server/khu vực');}
    if(playTime && p.playTime?.toLowerCase().includes(playTime)){score+=10;reasons.push('Khớp giờ chơi');}
    if(style && owner.playStyle && (style===owner.playStyle.toLowerCase() || style==='flex' || owner.playStyle==='flex')){score+=10;reasons.push('Phong cách phù hợp');}
    const overlap=(owner.availabilityDays||[]).filter(d=>days.includes(d)); if(days.length && overlap.length){score+=15;reasons.push(`Trùng ${overlap.length} ngày rảnh`);}
    const activity=owner.lastSeen?Math.max(0,5-Math.floor((now-new Date(owner.lastSeen).getTime())/86400000)):0; if(activity>0){score+=Math.min(5,activity);reasons.push('Hoạt động gần đây');}
    return {...p,score:Math.min(100,score),reasons,playStyle:owner.playStyle||'flex',availabilityDays:owner.availabilityDays||[],prestige:Number(owner.prestige||0)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,12);
  res.json({matches});
});
app.get('/api/events', auth, (req,res)=>{
  const db=load(); const events=(db.events||[]).slice().sort((a,b)=>new Date(a.startAt)-new Date(b.startAt)).map(e=>({...e,joined:(e.participants||[]).includes(req.user.id),checkedIn:(e.checkedIn||[]).includes(req.user.id),checkinCode:['Boss','Kì Cựu'].includes(req.user.role)?e.checkinCode:undefined})); res.json({events});
});
app.post('/api/events', auth, admin, requirePermission('manageEvents'), (req,res)=>{
  const title=cleanText(req.body.title,100), description=cleanText(req.body.description,500), startAt=String(req.body.startAt||''), endAt=String(req.body.endAt||'');
  if(!title||!startAt||Number.isNaN(new Date(startAt).getTime())) return res.status(400).json({error:'Tên và thời gian sự kiện chưa hợp lệ'});
  const db=load(); const e={id:crypto.randomUUID(),title,description,startAt:new Date(startAt).toISOString(),endAt:endAt&&!Number.isNaN(new Date(endAt).getTime())?new Date(endAt).toISOString():'',createdBy:req.user.username,participants:[],checkedIn:[],checkinCode:crypto.randomBytes(3).toString('hex').toUpperCase(),createdAt:new Date().toISOString()}; db.events.push(e); addLog(db,'event_create',{by:req.user.username,event:title}); save(db); res.json({event:e});
});
app.post('/api/events/:id/join', auth, (req,res)=>{
  const db=load(); const e=db.events.find(x=>x.id===req.params.id); if(!e)return res.status(404).json({error:'Không tìm thấy sự kiện'}); e.participants=e.participants||[]; const i=e.participants.indexOf(req.user.id); if(i>=0)e.participants.splice(i,1); else {e.participants.push(req.user.id);addXp(db.users.find(u=>u.id===req.user.id),10,'event_join_'+e.id,0);} save(db); res.json({joined:i<0,count:e.participants.length});
});
app.post('/api/events/:id/checkin', auth, (req,res)=>{
  const code=cleanText(req.body.code,20).toUpperCase(); const db=load(); const e=db.events.find(x=>x.id===req.params.id); if(!e)return res.status(404).json({error:'Không tìm thấy sự kiện'}); if(code!==String(e.checkinCode||'').toUpperCase())return res.status(400).json({error:'Mã check-in không đúng'}); e.checkedIn=e.checkedIn||[]; if(!e.checkedIn.includes(req.user.id)){e.checkedIn.push(req.user.id);addXp(db.users.find(u=>u.id===req.user.id),25,'event_checkin_'+e.id,0);} save(db); res.json({ok:true});
});
app.delete('/api/events/:id', auth, admin, requirePermission('manageEvents'), (req,res)=>{ const db=load(); const i=db.events.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:'Không tìm thấy sự kiện'}); const [e]=db.events.splice(i,1); addLog(db,'event_delete',{by:req.user.username,event:e.title}); save(db); res.json({ok:true}); });
app.get('/api/admin/analytics', auth, admin, requirePermission('viewAnalytics'), (req,res)=>{
  const db=load(), now=Date.now(), since24=now-86400000; const storageBytes=dir=>{let t=0;try{for(const f of fs.readdirSync(dir)){const p=path.join(dir,f);const st=fs.statSync(p);if(st.isFile())t+=st.size;}}catch{}return t;};
  const topXp=db.users.slice().sort((a,b)=>(b.xp||0)-(a.xp||0)).slice(0,5).map(u=>({id:u.id,displayName:u.displayName,xp:u.xp||0,level:levelFromXp(u.xp||0)}));
  res.json({users:db.users.length,online5m:db.users.filter(u=>u.lastSeen&&now-new Date(u.lastSeen).getTime()<300000).length,chat24h:db.chat.filter(m=>new Date(m.createdAt).getTime()>since24).length,teamOpen:db.teamPosts.filter(p=>p.status==='open').length,events:(db.events||[]).length,reportsOpen:db.reports.filter(r=>r.status==='open').length,backups:fs.readdirSync(backupDir).filter(f=>f.endsWith('.json')).length,storageBytes:storageBytes(dataDir)+storageBytes(uploadDir)+storageBytes(backupDir)+storageBytes(sessionDir),highlights:db.users.reduce((n,u)=>n+(u.highlights||[]).length,0),prestigeUsers:db.users.filter(u=>(u.prestige||0)>0).length,achievementTemplates:(db.achievementTemplates||[]).length,topXp});
});


// ===== v1.7 Unique Community: Pulse, Highlights, Achievement Composer, Prestige =====
app.get('/api/community-pulse', auth, (req,res)=>{
  const db=load(), now=Date.now(), since24=now-86400000;
  const activeUsers=db.users.filter(u=>!u.banned && u.lastSeen && now-new Date(u.lastSeen).getTime()<300000);
  const openPosts=db.teamPosts.filter(p=>p.status==='open' && (!p.expiresAt || new Date(p.expiresAt).getTime()>now));
  const gameCounts={}; for(const p of openPosts){const g=p.game||'Khác';gameCounts[g]=(gameCounts[g]||0)+1;}
  const hotGames=Object.entries(gameCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([game,count])=>({game,count}));
  const upcoming=(db.events||[]).filter(e=>new Date(e.startAt).getTime()>=now).sort((a,b)=>new Date(a.startAt)-new Date(b.startAt)).slice(0,3).map(e=>({id:e.id,title:e.title,startAt:e.startAt,participants:(e.participants||[]).length}));
  const recentAchievements=db.users.flatMap(u=>(u.achievements||[]).slice(-3).map(a=>({type:'achievement',displayName:u.displayName,title:a.title,at:a.awardedAt||u.profileUpdatedAt}))).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,5);
  res.json({online:activeUsers.length,looking:openPosts.length,chat24h:db.chat.filter(m=>new Date(m.createdAt).getTime()>since24).length,hotGames,upcoming,recentAchievements});
});

app.get('/api/highlights', auth, (req,res)=>{
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); res.json({highlights:(u?.highlights||[]).slice().reverse()});
});
app.post('/api/highlights', auth, uploadLimiter, chatImageUpload.single('image'), (req,res)=>{
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({error:'Không tìm thấy tài khoản'});
  const title=cleanText(req.body.title,80), game=cleanText(req.body.game,60), note=cleanText(req.body.note,240), externalUrl=cleanText(req.body.externalUrl,800);
  let url=req.file?'/uploads/'+req.file.filename:'';
  if(!url && externalUrl){try{const parsed=new URL(externalUrl); if(!['http:','https:'].includes(parsed.protocol))throw new Error(); url=parsed.toString();}catch{return res.status(400).json({error:'Link highlight không hợp lệ'});}}
  if(!title||!url)return res.status(400).json({error:'Cần tên highlight và ảnh/link'});
  u.highlights=Array.isArray(u.highlights)?u.highlights:[]; const h={id:crypto.randomUUID(),title,game,note,url,createdAt:new Date().toISOString()};u.highlights.push(h);if(u.highlights.length>24)u.highlights=u.highlights.slice(-24);addXp(u,8,'highlight_add',12*60*60*1000);save(db);res.json({highlight:h,user:safeUser(u)});
});
app.delete('/api/highlights/:id', auth, (req,res)=>{
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); const before=(u.highlights||[]).length;u.highlights=(u.highlights||[]).filter(h=>h.id!==req.params.id);if(u.highlights.length===before)return res.status(404).json({error:'Không tìm thấy highlight'});save(db);res.json({ok:true});
});

app.get('/api/admin/achievement-templates', auth, admin, requirePermission('manageAchievements'), (req,res)=>res.json({templates:load().achievementTemplates||[]}));
app.post('/api/admin/achievement-templates', auth, admin, requirePermission('manageAchievements'), (req,res)=>{
  const title=cleanText(req.body.title,80), description=cleanText(req.body.description,240), icon=cleanText(req.body.icon||'🏆',8), rarity=cleanText(req.body.rarity||'Common',20); const xp=Math.max(0,Math.min(100,Number(req.body.xp)||0));
  if(!title)return res.status(400).json({error:'Chưa nhập tên thành tích'}); const allowed=new Set(['Common','Rare','Epic','Legendary']); const db=load(); const t={id:crypto.randomUUID(),title,description,icon,rarity:allowed.has(rarity)?rarity:'Common',xp,createdBy:req.user.username,createdAt:new Date().toISOString()};db.achievementTemplates.push(t);addLog(db,'achievement_template_create',{by:req.user.username,title});save(db);res.json({template:t});
});
app.delete('/api/admin/achievement-templates/:id', auth, admin, requirePermission('manageAchievements'), (req,res)=>{const db=load();const i=db.achievementTemplates.findIndex(t=>t.id===req.params.id);if(i<0)return res.status(404).json({error:'Không tìm thấy mẫu'});db.achievementTemplates.splice(i,1);save(db);res.json({ok:true});});
app.post('/api/admin/achievement-templates/:id/award/:userId', auth, admin, requirePermission('manageAchievements'), (req,res)=>{
  const db=load(), t=db.achievementTemplates.find(x=>x.id===req.params.id), u=db.users.find(x=>x.id===req.params.userId);if(!t||!u)return res.status(404).json({error:'Không tìm thấy mẫu hoặc thành viên'});u.achievements=Array.isArray(u.achievements)?u.achievements:[];u.achievements.push({id:crypto.randomUUID(),title:t.title,description:t.description,icon:t.icon,rarity:t.rarity,awardedBy:req.user.username,awardedAt:new Date().toISOString()});if(t.xp)addXp(u,t.xp,'template_'+t.id,0);notifyUser(db,u.id,'achievement','Bạn nhận thành tích mới',`${t.icon} ${t.title}`,{route:'profile'});addLog(db,'achievement_template_award',{by:req.user.username,to:u.username,title:t.title});save(db);res.json({user:safeUser(u)});
});

app.post('/api/prestige', auth, (req,res)=>{
  const db=load(), u=db.users.find(x=>x.id===req.user.id); const level=levelFromXp(Number(u.xp||0)); if(level<5 || Number(u.xp||0)<1600)return res.status(400).json({error:'Cần đạt Level 5 (1600 XP) để Prestige'});u.prestige=Math.min(10,Number(u.prestige||0)+1);u.xp=0;u.xpMeta={};u.badges=Array.isArray(u.badges)?u.badges:[];u.badges.push({id:`prestige-${u.prestige}`,icon:'✦',name:`Prestige ${u.prestige}`,awardedAt:new Date().toISOString()});u.auraStatus='event';notifyUser(db,u.id,'prestige','Prestige thành công',`Bạn đã đạt Prestige ${u.prestige}!`,{route:'profile'});addLog(db,'prestige',{user:u.username,prestige:u.prestige});save(db);res.json({user:safeUser(u)});
});


// ===== v1.9 Voice Chat + Performance & Operations =====
const voiceRooms = new Map();
function hashRoomPin(value='') { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function publicVoiceRoom(room) {
  return { id:room.id, name:room.name, game:room.game, maxParticipants:room.maxParticipants, participants:room.participants.size, locked:!!room.pinHash, ownerUsername:room.ownerUsername, createdAt:room.createdAt };
}
function voicePeerView(peer) { return { connectionId:peer.connectionId, userId:peer.userId, username:peer.username, displayName:peer.displayName, role:peer.role, avatar:peer.avatar||'', muted:!!peer.muted, deafened:!!peer.deafened }; }
function makeVoiceToken(user) {
  const payload=Buffer.from(JSON.stringify({uid:user.id,exp:Date.now()+2*60*1000,nonce:crypto.randomBytes(8).toString('hex')})).toString('base64url');
  const sig=crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyVoiceToken(token='') {
  try {
    const [payload,sig]=String(token).split('.'); if(!payload||!sig)return null;
    const expected=crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected); if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); if(!data.uid||Number(data.exp)<Date.now())return null;
    const db=load(),u=db.users.find(x=>x.id===data.uid&&!x.banned); return u||null;
  } catch { return null; }
}
function voiceIceServers(user) {
  const customStun=String(process.env.VOICE_STUN_URL||'').trim();
  const servers=[{urls:customStun||['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
  if(process.env.WEBRTC_TURN_URL&&process.env.WEBRTC_TURN_SECRET){
    const ttl=Math.max(300,Math.min(86400,Number(process.env.WEBRTC_TURN_TTL_SECONDS)||3600));
    const username=`${Math.floor(Date.now()/1000)+ttl}:${user?.id||'guest'}`;
    const credential=crypto.createHmac('sha1',process.env.WEBRTC_TURN_SECRET).update(username).digest('base64');
    servers.push({urls:process.env.WEBRTC_TURN_URL,username,credential});
  } else if(process.env.WEBRTC_TURN_URL&&process.env.WEBRTC_TURN_USERNAME&&process.env.WEBRTC_TURN_CREDENTIAL) {
    servers.push({urls:process.env.WEBRTC_TURN_URL,username:process.env.WEBRTC_TURN_USERNAME,credential:process.env.WEBRTC_TURN_CREDENTIAL});
  }
  return servers;
}
app.get('/api/voice/config', auth, (req,res)=>res.json({iceServers:voiceIceServers(req.user),turnConfigured:!!process.env.WEBRTC_TURN_URL,relayFallback:process.env.VOICE_RELAY_FALLBACK!=='false',maxParticipants:load().systemSettings.voiceMaxParticipants,meshRecommendedMax:6,backgroundNote:'Hub giữ WebRTC và microphone khi chạy nền nếu Android/trình duyệt cho phép; nếu PWA bị hệ điều hành tạm dừng, micro sẽ tự khôi phục khi quay lại.'}));
app.post('/api/voice/token', auth, voiceLimiter, (req,res)=>res.json({token:makeVoiceToken(req.user),expiresInSeconds:120}));
app.get('/api/voice/rooms', auth, (req,res)=>{
  const rooms=[...voiceRooms.values()].filter(r=>Date.now()-r.createdMs<12*60*60*1000).map(publicVoiceRoom).sort((a,b)=>b.participants-a.participants||new Date(b.createdAt)-new Date(a.createdAt));
  res.json({rooms});
});
app.post('/api/voice/rooms', auth, voiceLimiter, (req,res)=>{
  if(!ensureCanCommunicate(req.user,res))return;
  const db=load(),settings=db.systemSettings;
  if(voiceRooms.size>=settings.voiceMaxRooms)return res.status(429).json({error:'Đã đạt giới hạn phòng voice đang mở'});
  const owned=[...voiceRooms.values()].filter(r=>r.ownerId===req.user.id); if(owned.length>=2)return res.status(429).json({error:'Mỗi thành viên chỉ mở tối đa 2 phòng voice cùng lúc'});
  const name=cleanText(req.body.name,60),game=cleanText(req.body.game,40)||'Chơi game cùng'; const pin=cleanText(req.body.pin,12);
  if(!name)return res.status(400).json({error:'Nhập tên phòng voice'}); if(pin&&pin.length<4)return res.status(400).json({error:'Mã phòng cần ít nhất 4 ký tự'});
  const requested=Math.max(2,Number(req.body.maxParticipants)||settings.voiceMaxParticipants); const maxParticipants=Math.min(settings.voiceMaxParticipants,requested,8);
  const room={id:crypto.randomBytes(4).toString('hex'),name,game,maxParticipants,pinHash:pin?hashRoomPin(pin):'',ownerId:req.user.id,ownerUsername:req.user.username,createdAt:new Date().toISOString(),createdMs:Date.now(),lastActive:Date.now(),participants:new Map()};
  voiceRooms.set(room.id,room); addLog(db,'voice_room_create',{by:req.user.username,room:room.id,category:'system'});save(db);res.json({room:publicVoiceRoom(room)});
});
app.delete('/api/voice/rooms/:id', auth, voiceLimiter, (req,res)=>{
  const room=voiceRooms.get(req.params.id);if(!room)return res.status(404).json({error:'Phòng không còn tồn tại'});if(room.ownerId!==req.user.id&&!['Boss','Kì Cựu'].includes(req.user.role))return res.status(403).json({error:'Bạn không có quyền đóng phòng này'});
  for(const peer of room.participants.values()){try{peer.ws.send(JSON.stringify({type:'room-closed'}));peer.ws.close(4001,'room closed');}catch{}}
  voiceRooms.delete(room.id);res.json({ok:true});
});

function collectUploadRefs(db,refs=new Set()){
  const take=v=>{if(typeof v==='string'&&v.startsWith('/uploads/'))refs.add(path.basename(v));};
  for(const u of (db?.users||[])){take(u.avatar);for(const h of (u.highlights||[]))take(h.url);}
  for(const m of (db?.chat||[]))take(m.attachmentUrl);
  return refs;
}
function referencedUploadFiles(db){
  const refs=collectUploadRefs(db);
  // Giữ cả file được tham chiếu bởi backup để Restore không bị mất avatar/highlight cũ.
  try{for(const file of fs.readdirSync(backupDir).filter(f=>/^db-.*\.json$/i.test(f))){try{collectUploadRefs(JSON.parse(fs.readFileSync(path.join(backupDir,file),'utf8')),refs);}catch{}}}catch{}
  return refs;
}
function cleanupSystemData(manualBy=''){
  const db=load(),settings=db.systemSettings,now=Date.now(),stats={logs:0,notifications:0,teamPosts:0,sessions:0,uploads:0};
  const logCut=now-settings.logRetentionDays*86400000,beforeLogs=db.logs.length;db.logs=db.logs.filter(x=>!x.at||new Date(x.at).getTime()>=logCut);stats.logs=beforeLogs-db.logs.length;
  const noteCut=now-90*86400000,beforeNotes=db.notifications.length;db.notifications=db.notifications.filter(x=>!x.createdAt||new Date(x.createdAt).getTime()>=noteCut);stats.notifications=beforeNotes-db.notifications.length;
  const teamCut=now-30*86400000,beforeTeams=db.teamPosts.length;db.teamPosts=db.teamPosts.filter(x=>{const exp=new Date(x.expiresAt||x.createdAt||0).getTime();return !exp||exp>=teamCut;});stats.teamPosts=beforeTeams-db.teamPosts.length;
  const sessions=persistentSessionStore.readAll(),beforeSessions=Object.keys(sessions).length;if(persistentSessionStore.prune(sessions))persistentSessionStore.writeAll(sessions);stats.sessions=beforeSessions-Object.keys(sessions).length;
  const refs=referencedUploadFiles(db),orphanCut=now-settings.uploadOrphanDays*86400000;
  try{for(const f of fs.readdirSync(uploadDir)){const p=path.join(uploadDir,f),st=fs.statSync(p);if(st.isFile()&&!refs.has(f)&&st.mtimeMs<orphanCut){fs.unlinkSync(p);stats.uploads++;}}}catch(e){console.warn('[Cleanup] upload:',e.message);}
  db.systemMeta={...(db.systemMeta||{}),lastCleanupAt:new Date().toISOString(),lastCleanupStats:stats};addLog(db,manualBy?'manual_cleanup':'scheduled_cleanup',{by:manualBy||'Hệ thống',category:'system',stats});save(db);return stats;
}
function maybeScheduledCleanup(){
  try{const db=load(),settings=db.systemSettings,last=new Date(db.systemMeta?.lastCleanupAt||0).getTime()||0;if(Date.now()-last>=settings.cleanupIntervalHours*3600000)cleanupSystemData('');}catch(e){console.error('[Cleanup]',e.message);}
}
setInterval(maybeScheduledCleanup,60*60*1000).unref?.();
setTimeout(maybeScheduledCleanup,30*1000).unref?.();

app.get('/api/admin/system-settings', auth, admin, bossOnly, (req,res)=>{const db=load();res.json({settings:db.systemSettings,meta:db.systemMeta||{}});});
app.post('/api/admin/system-settings', auth, admin, bossOnly, (req,res)=>{
  const db=load(),before=db.systemSettings;db.systemSettings=normalizeSystemSettings({...before,...(req.body||{})});addLog(db,'system_settings_update',{by:req.user.username,category:'security',before,after:db.systemSettings});save(db);res.json({settings:db.systemSettings});
});
app.post('/api/admin/system-cleanup', auth, admin, bossOnly, (req,res)=>{const stats=cleanupSystemData(req.user.username);res.json({ok:true,stats,meta:load().systemMeta||{}});});


// ===== v1.8 Professional System =====
app.get('/api/version', (req,res)=>res.json({name:APP_NAME,version:APP_VERSION,serverTime:new Date().toISOString()}));
app.get('/api/system/status', auth, (req,res)=>{
  const db=load(),settings=db.systemSettings;
  const dirSize=dir=>{let total=0;try{for(const f of fs.readdirSync(dir)){const p=path.join(dir,f),st=fs.statSync(p);if(st.isFile())total+=st.size;}}catch{}return total;};
  let writable=true; try{const t=path.join(storageRoot,'.healthcheck');fs.writeFileSync(t,String(Date.now()));fs.unlinkSync(t);}catch{writable=false;}
  const backups=fs.readdirSync(backupDir).filter(f=>/^db-.*\.json$/i.test(f)).map(f=>({f,t:fs.statSync(path.join(backupDir,f)).mtimeMs})).sort((a,b)=>b.t-a.t);
  const storageBytes=dirSize(dataDir)+dirSize(uploadDir)+dirSize(backupDir)+dirSize(sessionDir),alerts=[];
  if(!writable)alerts.push({level:'danger',title:'Storage không ghi được',detail:'Kiểm tra Railway Volume /app/storage.'});
  if(storageBytes>settings.storageWarningMb*1024*1024)alerts.push({level:'warning',title:'Dung lượng lưu trữ cao',detail:`Đã vượt ${settings.storageWarningMb} MB.`});
  const maxBackupAge=Math.max(6,Number(process.env.AUTO_BACKUP_HOURS||6)*3)*3600000;if(!backups[0]||Date.now()-backups[0].t>maxBackupAge)alerts.push({level:'warning',title:'Backup chưa cập nhật',detail:'Nên kiểm tra tác vụ sao lưu tự động.'});
  if(db.logs.length>5000)alerts.push({level:'info',title:'Audit Log lớn',detail:'Tác vụ tự dọn sẽ cắt log theo thời gian lưu đã cấu hình.'});
  res.json({
    app:{name:APP_NAME,version:APP_VERSION,node:process.version,uptimeSeconds:Math.floor(process.uptime()),serverTime:new Date().toISOString()},
    backend:{ok:true}, database:{ok:fs.existsSync(dbPath),users:db.users.length,logs:db.logs.length},
    storage:{ok:writable,root:storageRoot,bytes:storageBytes,dataBytes:dirSize(dataDir),uploadBytes:dirSize(uploadDir),backupBytes:dirSize(backupDir),sessionBytes:dirSize(sessionDir)},
    push:{ok:!!(vapidKeys.publicKey&&vapidKeys.privateKey),subscriptions:db.pushSubscriptions.length},
    backup:{count:backups.length,lastAt:backups[0]?new Date(backups[0].t).toISOString():null,autoHours:Math.max(1,Number(process.env.AUTO_BACKUP_HOURS||6))},
    voice:{rooms:voiceRooms.size,participants:[...voiceRooms.values()].reduce((n,r)=>n+r.participants.size,0),turnConfigured:!!process.env.WEBRTC_TURN_URL,relayFallback:process.env.VOICE_RELAY_FALLBACK!=='false'},
    cleanup:{lastAt:db.systemMeta?.lastCleanupAt||null,lastStats:db.systemMeta?.lastCleanupStats||null}, settings, alerts
  });
});

app.get('/api/account/summary' , auth, (req,res)=>{
  const db=load(); const all=persistentSessionStore.readAll();
  const sessions=Object.values(all).filter(s=>s?.uid===req.user.id).length;
  res.json({user:safeUser(req.user),security:{twoFactorEnabled:!!req.user.twoFactorEnabled,sessions,recoveryCodesRemaining:(req.user.recoveryCodeHashes||[]).length},permissions:permissionMatrix(db)[req.user.role]||{}});
});
app.get('/api/account/export', auth, (req,res)=>{
  const db=load(); const u=req.user;
  const payload={exportedAt:new Date().toISOString(),version:APP_VERSION,profile:safeUser(u),friends:db.friendRequests.filter(r=>r.fromUserId===u.id||r.toUserId===u.id),notifications:db.notifications.filter(n=>n.userId===u.id),teamPosts:db.teamPosts.filter(p=>p.userId===u.id),directMessages:db.directMessages.filter(m=>m.userId===u.id||m.toUserId===u.id),reports:db.reports.filter(r=>r.reporterId===u.id)};
  res.setHeader('Content-Disposition',`attachment; filename="giatoc-account-${u.username}.json"`); res.type('application/json').send(JSON.stringify(payload,null,2));
});

app.get('/api/notification-preferences', auth, (req,res)=>res.json({preferences:normalizeNotificationPrefs(req.user.notificationPrefs)}));
app.post('/api/notification-preferences', auth, (req,res)=>{
  const db=load(),u=db.users.find(x=>x.id===req.user.id); if(!u)return res.status(404).json({error:'Không tìm thấy tài khoản'});
  const incoming=req.body||{}; const next={...normalizeNotificationPrefs(u.notificationPrefs)};
  for(const k of ['pushEnabled','dm','mentions','friends','achievements','moderation','events','system','quietEnabled']) if(typeof incoming[k]==='boolean') next[k]=incoming[k];
  if(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(incoming.quietStart||''))) next.quietStart=String(incoming.quietStart);
  if(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(incoming.quietEnd||''))) next.quietEnd=String(incoming.quietEnd);
  next.timezoneOffsetMinutes=Math.max(-720,Math.min(840,Number(incoming.timezoneOffsetMinutes)||0)); u.notificationPrefs=next;
  addLog(db,'notification_preferences_update',{by:u.username,category:'security'}); save(db); res.json({preferences:next});
});

app.get('/api/admin/permissions', auth, admin, (req,res)=>{const db=load();res.json({matrix:permissionMatrix(db),keys:['manageMembers','manageAchievements','manageReports','manageBackups','viewAnalytics','manageEvents','viewAudit','managePermissions']});});
app.post('/api/admin/permissions', auth, admin, bossOnly, (req,res)=>{
  const db=load(),current=permissionMatrix(db),incoming=req.body?.matrix||{}; const roles=['Kì Cựu','Member']; const keys=Object.keys(DEFAULT_PERMISSION_MATRIX.Boss);
  for(const role of roles){current[role]=current[role]||{};for(const key of keys) if(typeof incoming?.[role]?.[key]==='boolean') current[role][key]=incoming[role][key];}
  current.Boss=structuredClone(DEFAULT_PERMISSION_MATRIX.Boss); db.permissionMatrix=current; addLog(db,'permission_matrix_update',{by:req.user.username,category:'security',after:current});save(db);res.json({matrix:current});
});

app.get('/api/admin/audit', auth, admin, requirePermission('viewAudit'), (req,res)=>{
  const db=load(); const q=cleanText(req.query.q,80).toLowerCase(),category=cleanText(req.query.category,30); const limit=Math.max(20,Math.min(500,Number(req.query.limit)||150));
  let logs=db.logs.slice().reverse(); if(category) logs=logs.filter(x=>x.category===category); if(q) logs=logs.filter(x=>JSON.stringify(x).toLowerCase().includes(q)); res.json({logs:logs.slice(0,limit)});
});

app.post('/api/admin/reports/:id/workflow', auth, admin, requirePermission('manageReports'), (req,res)=>{
  const db=load(),report=db.reports.find(r=>r.id===req.params.id); if(!report)return res.status(404).json({error:'Không tìm thấy báo cáo'});
  const allowed=new Set(['open','in_review','resolved','dismissed']); const status=cleanText(req.body.status,20); if(!allowed.has(status))return res.status(400).json({error:'Trạng thái không hợp lệ'});
  const before={status:report.status,assignedTo:report.assignedTo||'',internalNote:report.internalNote||''}; report.status=status; report.assignedTo=cleanText(req.body.assignedTo||report.assignedTo||req.user.username,40); report.internalNote=cleanText(req.body.internalNote||report.internalNote||'',500); report.updatedAt=new Date().toISOString(); report.history=Array.isArray(report.history)?report.history:[]; report.history.push({at:report.updatedAt,by:req.user.username,status,note:report.internalNote}); if(['resolved','dismissed'].includes(status)){report.resolvedAt=report.updatedAt;report.resolvedBy=req.user.username;}
  addLog(db,'report_workflow_update',{by:req.user.username,report:report.id,category:'moderation',before,after:{status:report.status,assignedTo:report.assignedTo,internalNote:report.internalNote}});save(db);res.json({report});
});

// ===== Session & Security Center v1.5 =====
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


app.get('/api/security/2fa/status', auth, (req,res)=>res.json({enabled:!!req.user.twoFactorEnabled}));
app.post('/api/security/2fa/setup', auth, (req,res)=>{
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); if(u.twoFactorEnabled)return res.status(400).json({error:'2FA đã bật'}); const secret=randomBase32(32); u.twoFactorPendingSecret=secret; save(db); const issuer='GiaToc Name Hub'; const label=encodeURIComponent(`${issuer}:${u.username}`); const uri=`otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`; res.json({secret,uri});
});
app.post('/api/security/2fa/confirm', auth, (req,res)=>{
  const db=load(); const u=db.users.find(x=>x.id===req.user.id); if(!u.twoFactorPendingSecret)return res.status(400).json({error:'Chưa tạo khóa 2FA'}); if(!verifyTotp(u.twoFactorPendingSecret,req.body.code))return res.status(400).json({error:'Mã xác thực không đúng'}); const codes=makeRecoveryCodes(); u.twoFactorSecret=u.twoFactorPendingSecret;u.twoFactorPendingSecret='';u.twoFactorEnabled=true;u.recoveryCodeHashes=codes.map(hashRecovery);addLog(db,'2fa_enable',{user:u.username});save(db);res.json({ok:true,recoveryCodes:codes});
});
app.post('/api/security/2fa/disable', auth, loginLimiter, async (req,res)=>{
  const password=String(req.body.password||''); const db=load(); const u=db.users.find(x=>x.id===req.user.id); if(!u||!await bcrypt.compare(password,u.passwordHash))return res.status(401).json({error:'Mật khẩu không đúng'});u.twoFactorEnabled=false;u.twoFactorSecret='';u.twoFactorPendingSecret='';u.recoveryCodeHashes=[];addLog(db,'2fa_disable',{user:u.username});save(db);res.json({ok:true});
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


const voiceWss = new WebSocketServer({ server:httpServer, path:'/voice-signal', maxPayload:64*1024 });
function wsSend(ws,payload){if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(payload));}catch{}}}
function leaveVoicePeer(peer, reason='left'){
  const roomId=peer?.roomId;if(!roomId)return;const room=voiceRooms.get(roomId);peer.roomId='';if(!room)return;
  room.participants.delete(peer.connectionId);room.lastActive=Date.now();for(const other of room.participants.values())wsSend(other.ws,{type:'peer-left',connectionId:peer.connectionId,reason});
}
voiceWss.on('connection',(ws,req)=>{
  let token='';try{token=new URL(req.url,'http://localhost').searchParams.get('token')||'';}catch{}
  const user=verifyVoiceToken(token);if(!user){ws.close(4003,'unauthorized');return;}
  const peer={ws,connectionId:crypto.randomUUID(),userId:user.id,username:user.username,displayName:user.displayName,role:user.role,avatar:user.avatar||'',roomId:'',muted:false,deafened:false,joinAttempts:0,relayWindowStart:Date.now(),relayPackets:0};
  ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});wsSend(ws,{type:'ready',connectionId:peer.connectionId});
  ws.on('message',(raw,isBinary)=>{
    if(isBinary){
      const room=voiceRooms.get(peer.roomId);if(!room||peer.muted)return;
      const now=Date.now();if(now-peer.relayWindowStart>=1000){peer.relayWindowStart=now;peer.relayPackets=0;}peer.relayPackets++;
      if(peer.relayPackets>40||raw.length<32||raw.length>4096)return;
      const header=Buffer.from(String(peer.connectionId).padEnd(36,' ').slice(0,36),'utf8');const packet=Buffer.concat([header,Buffer.from(raw)]);
      for(const other of room.participants.values())if(other.connectionId!==peer.connectionId&&!other.deafened&&other.ws?.readyState===WebSocket.OPEN)try{other.ws.send(packet,{binary:true});}catch{}
      return;
    }
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='join'){
      peer.joinAttempts++;if(peer.joinAttempts>8){ws.close(4008,'too many join attempts');return;}
      const room=voiceRooms.get(cleanText(msg.roomId,20));if(!room)return wsSend(ws,{type:'error',message:'Phòng voice không còn tồn tại'});
      if(room.pinHash&&hashRoomPin(cleanText(msg.pin,12))!==room.pinHash)return wsSend(ws,{type:'error',message:'Mã phòng không đúng'});
      if(room.participants.size>=room.maxParticipants)return wsSend(ws,{type:'error',message:'Phòng voice đã đầy'});
      if([...room.participants.values()].some(p=>p.userId===peer.userId))return wsSend(ws,{type:'error',message:'Tài khoản này đã ở trong phòng từ thiết bị khác'});
      leaveVoicePeer(peer,'switch-room');peer.roomId=room.id;peer.joinAttempts=0;room.participants.set(peer.connectionId,peer);room.lastActive=Date.now();
      const peers=[...room.participants.values()].filter(p=>p.connectionId!==peer.connectionId).map(voicePeerView);wsSend(ws,{type:'joined',room:publicVoiceRoom(room),self:voicePeerView(peer),peers});
      for(const other of room.participants.values())if(other.connectionId!==peer.connectionId)wsSend(other.ws,{type:'peer-joined',peer:voicePeerView(peer)});
      return;
    }
    if(msg.type==='leave'){leaveVoicePeer(peer,'left');wsSend(ws,{type:'left'});return;}
    if(msg.type==='state'){
      const room=voiceRooms.get(peer.roomId);if(!room)return;peer.muted=!!msg.muted;peer.deafened=!!msg.deafened;for(const other of room.participants.values())if(other.connectionId!==peer.connectionId)wsSend(other.ws,{type:'peer-state',peer:voicePeerView(peer)});return;
    }
    if(msg.type==='signal'){
      const room=voiceRooms.get(peer.roomId);if(!room)return;const target=room.participants.get(String(msg.target||''));if(!target)return;const data=msg.data;if(!data||typeof data!=='object')return;wsSend(target.ws,{type:'signal',from:peer.connectionId,data});return;
    }
  });
  ws.on('close',()=>leaveVoicePeer(peer,'disconnected'));ws.on('error',()=>leaveVoicePeer(peer,'error'));
});
const voiceHeartbeat=setInterval(()=>{for(const ws of voiceWss.clients){if(ws.readyState!==WebSocket.OPEN)continue;if(ws.isAlive===false){try{ws.terminate();}catch{}continue;}ws.isAlive=false;try{ws.ping();}catch{}}for(const [id,room] of voiceRooms){if(room.participants.size===0&&Date.now()-room.lastActive>10*60*1000)voiceRooms.delete(id);}},30000);voiceHeartbeat.unref?.();

const autoBackupHours = Math.max(1, Math.min(168, Number(process.env.AUTO_BACKUP_HOURS || 6)));
setInterval(() => { try { const file = createBackupFile(); console.log(`[Backup] Tự động: ${file}`); } catch (e) { console.error('[Backup] Tự động lỗi:', e.message); } }, autoBackupHours * 60 * 60 * 1000).unref?.();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`GiaToc Name Hub v1.9.3 running on port ${PORT}`);
  console.log(`[Storage] ${storageRoot}`);
});
