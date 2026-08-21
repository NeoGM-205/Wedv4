const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CACHEABLE_GETS = new Set(['/api/me', '/api/members', '/api/music', '/api/friends', '/api/events', '/api/community-pulse', '/api/highlights']);
const isCacheableGet = url => CACHEABLE_GETS.has(url) || url.startsWith('/api/chat') || url.startsWith('/api/team-posts') || url.startsWith('/api/notifications') || url.startsWith('/api/dm/');
let me = null;
let adminCache = [];
let chatTimer = null;
let roleAvatarImg = null;
let bannerBgImg = null;
let imageToolImg = null;
let imageToolRotation = 0;
let qrBlobUrl = '';
let selectedChatRoom = 'general';
let replyingTo = null;
let notificationTimer = null;
let heartbeatTimer = null;
let clockTimer = null;
let voiceRoomTimer = null;
let activeRoute = 'overview';
let friendsState = { friends: [], incoming: [], outgoing: [], members: [] };
let selectedDmUserId = '';

const roleMeta = {
  'Boss': { key: 'boss', icon: '👑', label: 'BOSS', fallback: '/assets/avatar-boss.svg', c1: '#ffd86b', c2: '#ff7a00' },
  'Kì Cựu': { key: 'elder', icon: '🛡️', label: 'KÌ CỰU', fallback: '/assets/avatar-elder.svg', c1: '#77ddff', c2: '#7c5cff' },
  'Member': { key: 'member', icon: '👤', label: 'MEMBER', fallback: '/assets/avatar-member.svg', c1: '#7fffe3', c2: '#1fa6ff' }
};
const meta = role => roleMeta[role] || roleMeta.Member;
const avatarOf = u => u?.avatar || meta(u?.role).fallback;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmtDate = v => v ? new Date(v).toLocaleString('vi-VN') : '';
const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function msg(t) { if ($('#msg')) $('#msg').textContent = t; }
function avatarHTML(u, size = 'small') { const m = meta(u.role); return `<div class="role-avatar ${m.key} ${size} ${auraClass(u)}"><img src="${esc(avatarOf(u))}" alt="Avatar ${esc(u.displayName)}"><span class="role-crown">${m.icon}</span></div>`; }
function isOnline() { return navigator.onLine !== false; }
function auraClass(u){ const v=u?.auraStatus||'online'; return ['online','looking','busy','event','chill'].includes(v)?`aura-${v}`:'aura-online'; }
const TOOLBOX_ITEMS=[['chat','💬 Chat'],['voice','🎙️ Voice'],['team','🤝 Tìm đội'],['match','🎯 Ghép đội'],['events','📅 Sự kiện'],['showcase','🖼️ Showcase'],['highlights','🎬 Highlights'],['profile-card','👤 Profile Card'],['qr','🔳 QR'],['pdf','📄 PDF'],['avatar-tool','👑 Avatar Role'],['banner','🖼️ Banner'],['image-tool','✂️ Ảnh'],['music','🎵 Nhạc'],['friends','👥 Bạn bè']];

function httpError(message, status, data = {}) { const e = new Error(message); e.httpStatus = status; e.isHttp = true; e.data = data; return e; }

async function snapshotPut(key, value) {
  try { await window.OfflineDB?.putSnapshot(key, value); } catch (e) { console.warn('Offline snapshot:', e); }
}
async function snapshotGet(key) {
  try { return await window.OfflineDB?.getSnapshot(key); } catch { return null; }
}

async function api(url, opt = {}) {
  const method = String(opt.method || 'GET').toUpperCase();
  const headers = { ...(opt.headers || {}) };
  if (!(opt.body instanceof FormData) && opt.body != null) headers['Content-Type'] = 'application/json';
  try {
    const r = await fetch(url, { ...opt, method, headers, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw httpError(j.error || 'Có lỗi xảy ra', r.status, j);
    if (method === 'GET' && isCacheableGet(url)) await snapshotPut(url, j);
    return j;
  } catch (e) {
    if (method === 'GET' && isCacheableGet(url) && !e.isHttp) {
      const cached = await snapshotGet(url);
      if (cached) return { ...cached.value, __offline: true, __savedAt: cached.savedAt };
    }
    if (opt.queueIfOffline && !e.isHttp) {
      let body = null;
      try { body = opt.body ? JSON.parse(opt.body) : null; } catch { body = null; }
      await window.OfflineDB?.enqueue({ type: opt.queueIfOffline, url, method, bodyType: 'json', body });
      await updateOfflineStatus();
      window.requestBackgroundSync?.();
      return { queued: true, offline: true };
    }
    throw e;
  }
}

async function updateOfflineStatus() {
  const online = isOnline();
  const state = $('#networkState');
  const bar = $('#offlineBar');
  const countEl = $('#offlineQueueCount');
  let count = 0;
  try { count = await window.OfflineDB?.countQueue?.() || 0; } catch {}
  if (state) {
    state.textContent = online ? '🟢 Có mạng' : '🟠 Đang offline';
    state.className = `network-pill ${online ? 'online' : 'offline'}`;
  }
  if (countEl) countEl.textContent = count ? `${count} thao tác chờ đồng bộ` : 'Không có thao tác chờ';
  const detail = $('#offlineQueueDetail');
  if (detail) {
    const items = await window.OfflineDB?.listQueue?.() || [];
    detail.innerHTML = items.slice(0, 5).map(x => `<span class="sync-chip ${esc(x.status || 'pending')}">${x.status === 'error' ? '⚠️' : '⏳'} ${esc(x.type || 'sync')} ${x.retries ? `• thử ${x.retries}` : ''}</span>`).join('');
  }
  if (bar) bar.classList.toggle('is-offline', !online);
  const chatState = $('#chatConnectionState');
  if (chatState) chatState.textContent = online ? 'Online • tự làm mới' : 'Offline • dùng dữ liệu đã lưu';
  await renderSyncCenter();
}
window.updateConnectivity = updateOfflineStatus;

function requireOnline(action = 'Thao tác này') {
  if (isOnline()) return true;
  alert(`${action} cần kết nối mạng.`);
  return false;
}

async function syncOfflineQueue(showResult = false) {
  if (!isOnline()) { if (showResult) alert('Chưa có mạng để đồng bộ.'); return; }
  const items = await window.OfflineDB?.listQueue?.() || [];
  if (!items.length) { await updateOfflineStatus(); if (showResult) alert('Không có dữ liệu chờ đồng bộ.'); return; }
  let done = 0;
  for (const item of items) {
    if (item.status === 'conflict') continue;
    try {
      let response;
      if (item.type === 'avatar' && item.fileBlob) {
        const fd = new FormData();
        fd.append('avatar', item.fileBlob, item.fileName || 'avatar.jpg');
        response = await fetch('/api/avatar', { method: 'POST', body: fd, credentials: 'same-origin' });
      } else {
        response = await fetch(item.url, {
          method: item.method || 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: item.body == null ? undefined : JSON.stringify(item.body)
        });
      }
      if (response.status === 401 || response.status === 403) {
        if (showResult) alert('Cần đăng nhập lại trước khi đồng bộ dữ liệu offline.');
        break;
      }
      if (!response.ok) {
        if (response.status === 409 && item.type === 'profile') {
          const conflictData = await response.json().catch(() => ({}));
          await window.OfflineDB?.updateQueue?.(item.id, { status: 'conflict', conflictData, lastError: conflictData.error || 'Xung đột dữ liệu hồ sơ', lastTriedAt: Date.now() });
          continue;
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          const detail = await response.json().catch(() => ({}));
          await window.OfflineDB?.updateQueue?.(item.id, { status: 'error', retries: (item.retries || 0) + 1, lastError: detail.error || `HTTP ${response.status}`, lastTriedAt: Date.now() });
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      await window.OfflineDB.deleteQueue(item.id);
      done++;
    } catch (e) {
      console.warn('Sync queue:', e);
      await window.OfflineDB?.updateQueue?.(item.id, { status: 'error', retries: (item.retries || 0) + 1, lastError: String(e.message || e), lastTriedAt: Date.now() });
      break;
    }
  }
  await updateOfflineStatus();
  if (done) {
    try { me = (await api('/api/me')).user; await snapshotPut('/api/me', { user: me }); renderProfile(); } catch {}
    await Promise.allSettled([members(), music(), loadChat(), loadTeamPosts(), loadNotifications(), loadFriends()]);
  }
  if (showResult) alert(done ? `Đã đồng bộ ${done} thao tác.` : 'Chưa đồng bộ được dữ liệu.');
}
window.syncOfflineQueue = syncOfflineQueue;

window.refreshAfterBackgroundSync = async () => {
  if (!me || !isOnline()) return;
  try { me = (await api('/api/me')).user; renderProfile(); } catch {}
  await Promise.allSettled([members(), music(), loadChat(), loadTeamPosts(), loadNotifications(), loadFriends(), adminUsers()]);
  await updateOfflineStatus();
};

async function clearOfflineData() {
  if (!confirm('Xóa dữ liệu đã lưu offline và các thao tác đang chờ đồng bộ trên thiết bị này?')) return;
  await window.OfflineDB?.clearAll?.();
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_RUNTIME_CACHE' });
  await updateOfflineStatus();
  alert('Đã xóa dữ liệu offline trên thiết bị.');
}

async function register() {
  if (!requireOnline('Đăng ký')) return;
  try {
    const j = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('#user').value, password: $('#pass').value, displayName: $('#display').value }) });
    me = j.user; await snapshotPut('/api/me', { user: me }); show();
  } catch (e) { msg(e.message); }
}
async function login() {
  if (!requireOnline('Đăng nhập')) return;
  const payload={username:$('#user').value,password:$('#pass').value};
  try {
    let j;
    try { j=await api('/api/login',{method:'POST',body:JSON.stringify(payload)}); }
    catch(e){ if(e.httpStatus===428&&e.data?.twoFactorRequired){const code=prompt('Nhập mã 2FA 6 số hoặc Recovery Code:','');if(!code)throw e;j=await api('/api/login',{method:'POST',body:JSON.stringify({...payload,totp:code})});} else throw e; }
    me = j.user; await snapshotPut('/api/me', { user: me }); show();
  } catch (e) { msg(e.message); }
}
async function logout() {
  if (!requireOnline('Đăng xuất an toàn')) return;
  await leaveVoiceRoom(true);
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  await window.OfflineDB?.clearAll?.();
  location.reload();
}

function routeTo(route) {
  const allowed = ['overview','profile','chat','voice','team','match','events','profile-card','showcase','highlights','toolbox','notifications','friends','sync-center','avatar-tool','qr','pdf','tournament','banner','image-tool','music','security','status','admin'];
  if (!allowed.includes(route)) route = 'overview';
  if (route === 'admin' && !['Boss','Kì Cựu'].includes(me?.role)) route = 'overview';
  activeRoute = route;
  $$('.page-section').forEach(s => s.hidden = s.dataset.section !== route);
  $$('.hub-nav [data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  history.replaceState(null, '', '#' + route);
  if (route === 'chat') { loadChat(); startChatTimer(); } else stopChatTimer();
  if (route === 'voice') { loadVoiceRooms(); startVoiceRoomRefresh(); } else stopVoiceRoomRefresh();
  if (route === 'team') loadTeamPosts();
  if (route === 'match') { if ($('#matchGame') && $('#teamGame')) $('#matchGame').value=$('#teamGame').value; }
  if (route === 'events') loadEvents();
  if (route === 'profile-card') drawProfileCard();
  if (route === 'showcase') renderProfileShowcase();
  if (route === 'highlights') loadHighlights();
  if (route === 'toolbox') renderToolboxOptions();
  if (route === 'notifications') { loadNotifications(); refreshPushStatus(); loadNotificationPreferences(); }
  if (route === 'friends') loadFriends();
  if (route === 'sync-center') renderSyncCenter();
  if (route === 'security') { loadSessions(); loadTwoFactorStatus(); loadAccountCenter(); }
  if (route === 'status') { loadSystemStatus(); refreshCacheManager(); updatePerformanceUi(); }
  if (route === 'avatar-tool') drawRoleAvatar();
  if (route === 'banner') drawBanner();
  if (route === 'admin' && isOnline()) { loadAdminReports(); loadBackups(); loadAnalytics(); loadAchievementTemplates(); loadPermissions(); loadAudit(); if (me?.role === 'Boss') loadSystemSettings(); }
  if (route === 'admin' && !isOnline()) $('#users').innerHTML = '<p class="offline-note">🟠 Quản trị tài khoản cần mạng. Các công cụ khác vẫn dùng offline được.</p>';
}
let routesReady = false;
function setupRoutes() {
  if (routesReady) return;
  routesReady = true;
  window.addEventListener('hashchange', () => me && routeTo(location.hash.slice(1) || 'overview'));
}

function runUiAction(action, el) {
  const actions = {
    'login': login, 'register': register, 'logout': logout,
    'upload-avatar': uploadAvatar, 'save-profile': saveProfile, 'send-chat': sendChat,
    'generate-qr': generateQR, 'download-qr': downloadQR,
    'merge-pdfs': mergePDFs, 'images-to-pdf': imagesToPDF, 'compress-pdf': compressPDF,
    'generate-tournament': generateTournament, 'draw-banner': drawBanner,
    'render-image-tool': renderImageTool, 'download-edited-image': downloadEditedImage,
    'add-music': addMusic, 'backup': backup, 'load-logs': loadLogs,
    'load-role-avatar': loadRoleAvatar, 'draw-role-avatar': drawRoleAvatar,
    'load-banner-bg': loadBannerBg, 'load-image-tool': loadImageTool,
    'render-admin-users': renderAdminUsers, 'sync-offline': () => syncOfflineQueue(true),
    'clear-offline': clearOfflineData, 'change-chat-room': changeChatRoom, 'create-team-post': createTeamPost, 'load-team-posts': loadTeamPosts, 'read-all-notifications': readAllNotifications, 'load-sessions': loadSessions, 'change-password': changePassword,
    'load-friends': loadFriends, 'render-friend-directory': renderFriendDirectory, 'send-dm': sendDM, 'refresh-sync-center': renderSyncCenter,
    'enable-push': enablePush, 'disable-push': disablePush, 'load-admin-reports': loadAdminReports, 'load-backups': loadBackups,
    'find-team-match': findTeamMatch, 'create-event': createEvent, 'draw-profile-card': drawProfileCard, 'search-chat': loadChat,
    'setup-2fa': setupTwoFactor, 'confirm-2fa': confirmTwoFactor, 'disable-2fa': disableTwoFactor, 'load-analytics': loadAnalytics,
    'load-pulse': loadCommunityPulse, 'add-highlight': addHighlight, 'load-highlights': loadHighlights, 'save-toolbox': saveToolbox, 'prestige': prestige,
    'load-achievement-templates': loadAchievementTemplates, 'create-achievement-template': createAchievementTemplate,
    'save-notification-prefs': saveNotificationPreferences, 'load-account-center': loadAccountCenter, 'export-account-data': exportAccountData,
    'load-system-status': loadSystemStatus, 'check-app-update': checkAppUpdate, 'update-app-now': updateAppNow, 'clear-app-cache': clearAppCache,
    'load-permissions': loadPermissions, 'save-permissions': savePermissions, 'load-audit': loadAudit,
    'voice-create-room': createVoiceRoom, 'voice-refresh-rooms': loadVoiceRooms, 'voice-toggle-mute': toggleVoiceMute, 'voice-toggle-deafen': toggleVoiceDeafen, 'voice-enable-audio': unlockVoiceAudio, 'voice-leave': () => leaveVoiceRoom(false), 'voice-change-mic': changeVoiceMicrophone,
    'load-system-settings': loadSystemSettings, 'save-system-settings': saveSystemSettings, 'run-system-cleanup': runSystemCleanup
  };
  if (action === 'download-canvas') return downloadCanvas(el.dataset.canvas, el.dataset.filename || 'download.png');
  if (action === 'rotate-image') return rotateImage(Number(el.dataset.deg) || 0);
  if (action === 'delete-chat') return deleteChat(el.dataset.id);
  if (action === 'edit-chat') return editChat(el.dataset.id);
  if (action === 'pin-chat') return pinChat(el.dataset.id);
  if (action === 'add-achievement') return addAchievement(el.dataset.id);
  if (action === 'ban-user') return ban(el.dataset.id, el.dataset.banned === 'true');
  if (action === 'set-role') return setRole(el.dataset.id, el.value);
  if (action === 'reply-chat') return setChatReply(el.dataset.id);
  if (action === 'cancel-chat-reply') return setChatReply('');
  if (action === 'react-chat') return reactChat(el.dataset.id, el.dataset.emoji);
  if (action === 'close-team-post') return closeTeamPost(el.dataset.id);
  if (action === 'delete-team-post') return deleteTeamPost(el.dataset.id);
  if (action === 'event-join') return toggleEventJoin(el.dataset.id);
  if (action === 'event-checkin') return checkinEvent(el.dataset.id);
  if (action === 'event-delete') return deleteEvent(el.dataset.id);
  if (action === 'open-notification') return openNotification(el.dataset.id, el.dataset.route, el.dataset.room, el.dataset.dm);
  if (action === 'revoke-session') return revokeSession(el.dataset.id);
  if (action === 'friend-request') return requestFriend(el.dataset.id);
  if (action === 'friend-accept') return acceptFriend(el.dataset.id);
  if (action === 'friend-decline') return declineFriend(el.dataset.id);
  if (action === 'friend-remove') return removeFriend(el.dataset.id);
  if (action === 'open-dm') return openDM(el.dataset.id);
  if (action === 'report-target') return reportTarget(el.dataset.type, el.dataset.id);
  if (action === 'retry-queue') return retryQueueItem(Number(el.dataset.id));
  if (action === 'delete-queue') return deleteQueueItemUI(Number(el.dataset.id));
  if (action === 'resolve-local') return resolveConflictLocal(Number(el.dataset.id));
  if (action === 'resolve-server') return resolveConflictServer(Number(el.dataset.id));
  if (action === 'mute-user') return muteUser(el.dataset.id);
  if (action === 'resolve-report') return resolveReport(el.dataset.id, el.dataset.status || 'resolved');
  if (action === 'workflow-report') return workflowReport(el.dataset.id, el.dataset.status || 'in_review');
  if (action === 'restore-backup') return restoreBackup(el.dataset.file);
  if (action === 'delete-backup') return deleteBackup(el.dataset.file);
  if (action === 'delete-highlight') return deleteHighlight(el.dataset.id);
  if (action === 'delete-achievement-template') return deleteAchievementTemplate(el.dataset.id);
  if (action === 'award-achievement-template') return awardAchievementTemplate(el.dataset.id);
  if (action === 'voice-join-room') return joinVoiceRoom(el.dataset.id, el.dataset.locked === 'true');
  if (action === 'voice-close-room') return closeVoiceRoom(el.dataset.id);

  const fn = actions[action]; if (fn) return fn();
}

function setupInteractions() {
  document.addEventListener('click', event => {
    const routeEl = event.target.closest('[data-route]');
    if (routeEl && me) { event.preventDefault(); return routeTo(routeEl.dataset.route); }
    const goEl = event.target.closest('[data-go]');
    if (goEl && me) { event.preventDefault(); return routeTo(goEl.dataset.go); }
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      event.preventDefault();
      try {
        const result = runUiAction(actionEl.dataset.action, actionEl);
        if (result?.catch) result.catch(err => { console.error(err); alert(err.message || 'Có lỗi xảy ra'); });
      } catch (err) { console.error(err); alert(err.message || 'Có lỗi xảy ra'); }
    }
  });
  document.addEventListener('change', event => { const el = event.target.closest('[data-change-action]'); if (el) runUiAction(el.dataset.changeAction, el); });
  document.addEventListener('input', event => { const el = event.target.closest('[data-input-action]'); if (el) runUiAction(el.dataset.inputAction, el); });
  document.addEventListener('keydown', event => {
    const el = event.target.closest('[data-enter-action]');
    if (el && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); runUiAction(el.dataset.enterAction, el); }
  });
}

function renderProfile() {
  if (!me) return;
  const m = meta(me.role);
  $('#profileAvatarWrap').className = `role-avatar ${m.key} hero ${auraClass(me)}`; $('#avatar').src = avatarOf(me);
  $('#name').textContent = me.displayName; $('#role').className = `role role-${m.key}`; $('#role').textContent = `${m.icon} ${m.label}`;
  $('#profilePageAvatarWrap').className = `role-avatar ${m.key} hero ${auraClass(me)}`; $('#profilePageAvatar').src = avatarOf(me);
  $('#profilePageName').textContent = me.displayName; $('#profilePageRole').className = `role role-${m.key}`; $('#profilePageRole').textContent = `${m.icon} ${m.label}`;
  $('#profileJoinDate').textContent = `Tham gia: ${fmtDate(me.createdAt)}`;
  $('#newName').value = me.displayName || ''; $('#bio').value = me.bio || ''; $('#games').value = me.games || ''; $('#gameId').value = me.gameId || ''; $('#discord').value = me.discord || '';
  if($('#auraStatus'))$('#auraStatus').value=me.auraStatus||'online'; if($('#playStyle'))$('#playStyle').value=me.playStyle||'flex'; if($('#availabilityStart'))$('#availabilityStart').value=me.availabilityStart||''; if($('#availabilityEnd'))$('#availabilityEnd').value=me.availabilityEnd||'';
  $$('#availabilityDays input[type=checkbox]').forEach(x=>x.checked=(me.availabilityDays||[]).includes(Number(x.value)));

  renderAchievements(me.achievements || []);
  renderLevelBadges();
}
function renderAchievements(items) {
  $('#achievementCount').textContent = `${items.length} thành tích`;
  $('#achievementList').innerHTML = items.length ? items.map(a => `<article class="achievement"><div class="achievement-icon">${esc(a.icon || '🏆')}</div><div><b>${esc(a.title)}</b><p>${esc(a.description || '')}</p><small>Trao bởi ${esc(a.awardedBy || 'Hệ thống')} • ${fmtDate(a.awardedAt)}</small></div></article>`).join('') : '<p class="muted">Chưa có thành tích được trao.</p>';
}
function renderLevelBadges(){
  if(!me)return; const xp=Number(me.xp||0),level=Number(me.level||1),base=(level-1)*(level-1)*100,next=level*level*100,pct=Math.max(0,Math.min(100,((xp-base)/Math.max(1,next-base))*100));
  if($('#levelLabel'))$('#levelLabel').textContent=`Level ${level}`; if($('#xpLabel'))$('#xpLabel').textContent=`${xp} XP • còn ${Math.max(0,next-xp)} XP tới Level ${level+1}`; if($('#xpProgress'))$('#xpProgress').style.width=pct+'%';
  if($('#badgeList'))$('#badgeList').innerHTML=(me.badges||[]).map(b=>`<span class="badge-chip" title="${esc(b.name)}">${esc(b.icon||'🏅')} ${esc(b.name)}</span>`).join('')||'<span class="muted">Chưa có huy hiệu XP.</span>';
  if($('#prestigeLabel'))$('#prestigeLabel').textContent=`✦ Prestige ${Number(me.prestige||0)}`; if($('#prestigeBtn'))$('#prestigeBtn').disabled=level<5;
}
async function show() {
  if (!me) {
    try { me = (await api('/api/me')).user; }
    catch { if (!isOnline()) msg('🟠 Offline: cần đăng nhập online ít nhất một lần trên thiết bị này trước.'); return; }
  }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#adminNav').hidden = !['Boss','Kì Cựu'].includes(me.role);
  if($('#systemSettingsCard')) $('#systemSettingsCard').hidden = me.role !== 'Boss';
  if($('#eventAdminCard')) $('#eventAdminCard').hidden=!['Boss','Kì Cựu'].includes(me.role);
  renderProfile();
  await Promise.allSettled([members(), music(), adminUsers(), loadTeamPosts(), loadNotifications(), loadFriends(), loadCommunityPulse(), loadHighlights()]);
  renderPersonalToolbox();
  setupRoutes(); routeTo(location.hash.slice(1) || 'overview');
  await updateOfflineStatus();
  startAdaptiveTimers();
  if (isOnline()) { if ('SyncManager' in window) window.requestBackgroundSync?.(); else syncOfflineQueue(false); }
}

async function saveProfile() {
  const payload = { displayName: $('#newName').value, bio: $('#bio').value, games: $('#games').value, gameId: $('#gameId').value, discord: $('#discord').value, auraStatus: $('#auraStatus')?.value || 'online', playStyle: $('#playStyle')?.value || 'flex', availabilityStart: $('#availabilityStart')?.value || '', availabilityEnd: $('#availabilityEnd')?.value || '', availabilityDays: $$('#availabilityDays input:checked').map(x=>Number(x.value)), toolbox: me?.toolbox || [], baseUpdatedAt: me?.profileUpdatedAt || '' };
  try {
    const j = await api('/api/profile', { method: 'POST', body: JSON.stringify(payload), queueIfOffline: 'profile' });
    if (j.queued) {
      me = { ...me, ...payload, displayName: payload.displayName || me.displayName };
      await snapshotPut('/api/me', { user: me }); renderProfile();
      alert('Đã lưu hồ sơ trên thiết bị. Khi có mạng, hệ thống sẽ tự đồng bộ.'); return;
    }
    me = j.user; await snapshotPut('/api/me', { user: me }); renderProfile(); await members(); alert('Đã lưu hồ sơ.');
  } catch (e) {
    if (e.httpStatus === 409 && isOnline()) {
      try { me = (await api('/api/me')).user; await snapshotPut('/api/me', { user: me }); renderProfile(); } catch {}
      alert('Hồ sơ trên máy chủ đã thay đổi. Mình đã tải bản mới nhất; hãy chỉnh lại rồi lưu.'); return;
    }
    alert(e.message);
  }
}
async function uploadAvatar() {
  const f = $('#avatarFile').files[0]; if (!f) return alert('Chọn ảnh trước');
  if (!isOnline()) {
    await window.OfflineDB?.enqueue?.({ type: 'avatar', url: '/api/avatar', method: 'POST', fileBlob: f, fileName: f.name, mime: f.type });
    const preview = URL.createObjectURL(f); $('#avatar').src = preview; $('#profilePageAvatar').src = preview;
    await updateOfflineStatus(); window.requestBackgroundSync?.();
    alert('Avatar đã được xếp hàng chờ. Khi có mạng sẽ tự tải lên.'); return;
  }
  const fd = new FormData(); fd.append('avatar', f);
  const r = await fetch('/api/avatar', { method: 'POST', body: fd, credentials: 'same-origin' }); const j = await r.json().catch(() => ({}));
  if (!r.ok) return alert(j.error || 'Không thể tải avatar'); me = j.user; await snapshotPut('/api/me', { user: me }); renderProfile(); members();
}
async function members() {
  if (!me) return;
  try {
    const j = await api('/api/members'); const a = j.members || []; const online = a.filter(u => u.online).length;
    $('#memberCount').textContent = j.__offline ? `Dữ liệu offline • ${a.length} thành viên` : `${online} online / ${a.length} thành viên`;
    $('#memberList').innerHTML = a.map(u => { const m = meta(u.role); return `<div class="member role-card-${m.key}">${avatarHTML(u)}<span class="dot ${!j.__offline && u.online ? 'on' : ''}" title="${j.__offline ? 'Trạng thái đã lưu' : u.online ? 'Đang online' : 'Offline'}"></span><div class="member-info"><b>${esc(u.displayName)}</b><span class="mini-role ${m.key}">${m.icon} ${m.label}</span><small>${esc(u.games || '')}</small></div>${u.id !== me.id ? `<button class="tiny ghost report-btn" data-action="report-target" data-type="user" data-id="${esc(u.id)}">🚩</button>` : ''}</div>`; }).join('');
  } catch (e) { console.warn(e); }
}

async function music() {
  if (!me) return;
  try {
    const j = await api('/api/music'); const a = j.music || [];
    $('#musicList').innerHTML = `${j.__offline ? '<p class="offline-note">🟠 Đang xem thư viện đã lưu. Link nhạc bên ngoài có thể cần mạng để phát.</p>' : ''}${a.length ? a.map(m => `<div class="music"><b>${esc(m.title)}</b><br><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.url)}</a><br><small>Thêm bởi ${esc(m.addedBy)}</small></div>`).join('') : '<p class="muted">Chưa có bài nhạc nào được lưu.</p>'}`;
  } catch (e) { console.warn(e); }
}
async function addMusic() {
  const title = $('#musicTitle').value.trim(); const url = $('#musicUrl').value.trim();
  try { new URL(url); } catch { return alert('Link không hợp lệ.'); }
  try {
    const j = await api('/api/music', { method: 'POST', body: JSON.stringify({ title, url }), queueIfOffline: 'music' });
    if (j.queued) {
      const cached = await snapshotGet('/api/music'); const list = cached?.value?.music || [];
      if (!list.some(x => x.url === url)) list.push({ id: uid(), title: title || url, url, addedBy: me.username, createdAt: new Date().toISOString(), pending: true });
      await snapshotPut('/api/music', { music: list });
      alert('Đã lưu nhạc offline, sẽ đồng bộ khi có mạng.');
    }
    $('#musicUrl').value = ''; $('#musicTitle').value = ''; await music();
  } catch (e) { alert(e.message); }
}

function stopChatTimer() { if (chatTimer) clearInterval(chatTimer); chatTimer = null; }
function startChatTimer() { stopChatTimer(); if (isOnline() && !document.hidden && activeRoute === 'chat') chatTimer = setInterval(loadChat, 3500); }
async function loadChat() {
  if (!me) return;
  try {
    const q=$('#chatSearch')?.value?.trim()||'';
    const j = await api('/api/chat?room=' + encodeURIComponent(selectedChatRoom) + (q?'&q='+encodeURIComponent(q):''));
    const queued = await window.OfflineDB?.listQueue?.() || [];
    const pending = queued.filter(x => x.type === 'chat' && (x.body?.room || 'general') === selectedChatRoom).map(x => ({ id: 'pending-' + x.id, clientId: x.body?.clientId, userId: me.id, username: me.username, displayName: me.displayName, role: me.role, avatar: me.avatar, room:selectedChatRoom, text: x.body?.text || '', replyTo:x.body?.replyTo || '', reactions:{}, createdAt: new Date(x.createdAt).toISOString(), mine: true, pending: true }));
    const renderOne=m=>{const reactions=Object.entries(m.reactions||{}).filter(([,ids])=>ids.length).map(([emoji,ids])=>`<button class="reaction ${ids.includes(me.id)?'mine':''}" data-action="react-chat" data-id="${m.id}" data-emoji="${emoji}" ${m.pending?'disabled':''}>${emoji} ${ids.length}</button>`).join('');return `<div class="chat-message ${m.mine?'mine':''} ${m.pending?'pending':''} ${m.pinned?'pinned':''}">${avatarHTML(m)}<div class="chat-bubble">${m.pinned?'<div class="pinned-label">📌 Tin đã ghim</div>':''}${m.replyPreview?`<div class="reply-preview">↪ ${esc(m.replyPreview.displayName)}: ${esc(m.replyPreview.text)}</div>`:''}<div class="chat-head"><b>${esc(m.displayName)}</b><span class="mini-role ${meta(m.role).key}">${meta(m.role).icon} ${esc(m.role)}</span><small>${m.pending?'⏳ chờ đồng bộ':fmtDate(m.createdAt)}${m.editedAt?' • đã sửa':''}</small></div>${m.text?`<p>${esc(m.text)}</p>`:''}${m.attachmentUrl?`<a href="${esc(m.attachmentUrl)}" target="_blank"><img class="chat-image" src="${esc(m.attachmentUrl)}" alt="Ảnh chat"></a>`:''}<div class="chat-actions">${!m.pending?`<button class="tiny ghost" data-action="reply-chat" data-id="${m.id}">↩ Trả lời</button>${['👍','❤️','😂','🔥','🎮'].map(e=>`<button class="tiny ghost" data-action="react-chat" data-id="${m.id}" data-emoji="${e}">${e}</button>`).join('')}`:''}${m.mine&&!m.pending?`<button class="tiny ghost" data-action="edit-chat" data-id="${m.id}">✏️ Sửa</button>`:''}${['Boss','Kì Cựu'].includes(me.role)&&!m.pending?`<button class="tiny ghost" data-action="pin-chat" data-id="${m.id}">${m.pinned?'📌 Bỏ ghim':'📌 Ghim'}</button>`:''}${!m.pending&&!m.mine?`<button class="tiny ghost" data-action="report-target" data-type="chat" data-id="${m.id}">🚩 Báo cáo</button>`:''}${(m.mine||['Boss','Kì Cựu'].includes(me.role))&&!m.pending?`<button class="tiny danger" data-action="delete-chat" data-id="${m.id}">Xóa</button>`:''}</div><div class="reactions">${reactions}</div></div></div>`;};
    const all=[...(j.messages||[]),...pending]; $('#chatMessages').innerHTML=all.map(renderOne).join('')||'<p class="muted">Chưa có tin nhắn.</p>';
    if($('#pinnedMessages')) $('#pinnedMessages').innerHTML=(j.pinned||[]).length?`<b>📌 Đã ghim trong phòng</b>${(j.pinned||[]).map(m=>`<button class="pinned-chip" data-action="reply-chat" data-id="${m.id}">${esc(m.displayName)}: ${esc((m.text||'[ảnh]').slice(0,60))}</button>`).join('')}`:'';
    const box=$('#chatMessages'); box.scrollTop=box.scrollHeight;
  } catch (e) { $('#chatMessages').innerHTML = `<p class="offline-note">${esc(e.message)}</p>`; }
}
async function sendChat() {
  const input=$('#chatInput'); const text=input.value.trim(); const image=$('#chatImage')?.files?.[0]; if(!text&&!image)return;
  let attachmentUrl='';
  if(image){ if(!isOnline())return alert('Gửi ảnh chat cần mạng. Tin văn bản vẫn có thể gửi offline.'); const fd=new FormData();fd.append('image',image);const r=await fetch('/api/chat/upload',{method:'POST',body:fd,credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok)return alert(j.error||'Không thể tải ảnh');attachmentUrl=j.url||''; }
  const body={ text, attachmentUrl, clientId:uid(), room:selectedChatRoom, replyTo:replyingTo?.id || '' };
  try { const j=await api('/api/chat',{method:'POST',body:JSON.stringify(body),queueIfOffline:'chat'}); input.value=''; if($('#chatImage'))$('#chatImage').value=''; setChatReply(''); await loadChat(); if(j.queued) await updateOfflineStatus(); try{me=(await api('/api/me')).user;renderProfile();}catch{} } catch(e){ alert(e.message); }
}
async function editChat(id){if(!requireOnline('Sửa tin nhắn'))return;const current=$(`[data-action="edit-chat"][data-id="${CSS.escape(id)}"]`)?.closest('.chat-bubble')?.querySelector('p')?.textContent||'';const text=prompt('Sửa tin nhắn:',current);if(text==null||!text.trim())return;try{await api('/api/chat/'+id,{method:'PATCH',body:JSON.stringify({text})});await loadChat();}catch(e){alert(e.message)}}
async function pinChat(id){if(!requireOnline('Ghim tin nhắn'))return;try{await api(`/api/chat/${id}/pin`,{method:'POST',body:'{}'});await loadChat();}catch(e){alert(e.message)}}
async function deleteChat(id) {
  if (!requireOnline('Xóa tin nhắn')) return;
  try { await api('/api/chat/' + id, { method: 'DELETE' }); loadChat(); } catch (e) { alert(e.message); }
}


function changeChatRoom() { selectedChatRoom = $('#chatRoom')?.value || 'general'; setChatReply(''); loadChat(); }
function setChatReply(id) {
  const bar=$('#chatReplyBar'); if (!id) { replyingTo=null; if(bar) bar.hidden=true; return; }
  const el=$(`[data-action="reply-chat"][data-id="${CSS.escape(id)}"]`); const bubble=el?.closest('.chat-bubble'); replyingTo={id, text:bubble?.querySelector('p')?.textContent || ''};
  if(bar){bar.hidden=false;bar.innerHTML=`<span>↩ Đang trả lời: ${esc(replyingTo.text.slice(0,100))}</span><button class="tiny ghost" data-action="cancel-chat-reply">✕</button>`;} $('#chatInput')?.focus();
}
async function reactChat(id, emoji) { if(!requireOnline('Reaction')) return; try{await api(`/api/chat/${id}/reaction`,{method:'POST',body:JSON.stringify({emoji})}); await loadChat();}catch(e){alert(e.message);} }

async function loadTeamPosts() { if(!me)return; try { const j=await api('/api/team-posts'); const queued=await window.OfflineDB?.listQueue?.()||[]; const pending=queued.filter(x=>x.type==='team').map(x=>({id:'pending-'+x.id,userId:me.id,username:me.username,displayName:me.displayName,role:me.role,avatar:me.avatar,game:x.body?.game||'',mode:x.body?.mode||'',server:x.body?.server||'',playTime:x.body?.playTime||'',slots:x.body?.slots||1,note:x.body?.note||'',status:'pending',createdAt:new Date(x.createdAt).toISOString(),expiresAt:new Date(x.createdAt+(Number(x.body?.expireHours)||24)*3600000).toISOString(),mine:true,pending:true})); const posts=[...(j.posts||[]),...pending]; $('#teamPosts').innerHTML=posts.map(p=>`<article class="team-post ${p.status}">${avatarHTML(p)}<div class="team-main"><div class="team-head"><b>${esc(p.displayName)}</b><span class="mini-role ${meta(p.role).key}">${esc(p.role)}</span><span class="status-pill">${p.status==='pending'?'⏳ Chờ đồng bộ':p.status==='open'?'🟢 Đang tìm':p.status==='expired'?'⌛ Hết hạn':'✅ Đã đủ'}</span></div><h3>${esc(p.game)} ${p.mode?`• ${esc(p.mode)}`:''}</h3><p>${p.server?`🌐 ${esc(p.server)} • `:''}${p.playTime?`🕒 ${esc(p.playTime)} • `:''}👥 Cần ${p.slots}</p><p>${esc(p.note||'')}</p><small>Đăng ${fmtDate(p.createdAt)} • hết hạn ${fmtDate(p.expiresAt)}</small>${!p.pending?`<div class="team-actions">${!p.mine?`<button class="tiny ghost" data-action="report-target" data-type="team" data-id="${p.id}">🚩 Báo cáo</button>`:''}${(p.mine||['Boss','Kì Cựu'].includes(me.role))?`<button class="tiny ghost" data-action="close-team-post" data-id="${p.id}">${p.status==='open'?'Đã đủ người':'Mở lại'}</button><button class="tiny danger" data-action="delete-team-post" data-id="${p.id}">Xóa</button>`:''}</div>`:''}</div></article>`).join('')||'<p class="muted">Chưa có bài tìm đồng đội.</p>'; } catch(e){ $('#teamPosts').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`; } }
async function createTeamPost(){ const body={clientId:uid(),game:$('#teamGame').value,mode:$('#teamMode').value,server:$('#teamServer').value,playTime:$('#teamTime').value,slots:Number($('#teamSlots').value)||1,expireHours:Number($('#teamExpire').value)||24,note:$('#teamNote').value}; try{const j=await api('/api/team-posts',{method:'POST',body:JSON.stringify(body),queueIfOffline:'team'}); $('#teamNote').value=''; await loadTeamPosts(); if(j.queued) alert('Đã lưu bài vào hàng đợi. Khi có mạng sẽ tự đăng.');}catch(e){alert(e.message);} }
async function closeTeamPost(id){if(!requireOnline('Đổi trạng thái bài tìm đồng đội'))return;try{await api(`/api/team-posts/${id}/close`,{method:'POST'});loadTeamPosts();}catch(e){alert(e.message)}}
async function deleteTeamPost(id){if(!requireOnline('Xóa bài tìm đồng đội'))return;if(!confirm('Xóa bài này?'))return;try{await api(`/api/team-posts/${id}`,{method:'DELETE'});loadTeamPosts();}catch(e){alert(e.message)}}


async function findTeamMatch(){if(!requireOnline('Ghép đồng đội tự động'))return;try{const j=await api('/api/team-match',{method:'POST',body:JSON.stringify({game:$('#matchGame').value,mode:$('#matchMode').value,server:$('#matchServer').value,playTime:$('#matchTime').value,playStyle:$('#matchPlayStyle')?.value||me.playStyle,availabilityDays:me.availabilityDays||[]})});const ar=j.matches||[];$('#matchCount').textContent=`${ar.length} kết quả`;$('#matchResults').innerHTML=ar.map(p=>`<article class="team-post smart-match-card"><div class="match-score">${p.score}%</div>${avatarHTML(p)}<div class="team-main"><b>${esc(p.displayName)}</b><div class="match-meta"><span>${esc(p.playStyle||'flex')}</span>${p.prestige?`<span>✦ Prestige ${p.prestige}</span>`:''}</div><h3>${esc(p.game)} ${p.mode?`• ${esc(p.mode)}`:''}</h3><p>${esc((p.reasons||[]).join(' • '))}</p><p>${p.server?`🌐 ${esc(p.server)} • `:''}${p.playTime?`🕒 ${esc(p.playTime)} • `:''}👥 Cần ${p.slots}</p><p>${esc(p.note||'')}</p></div></article>`).join('')||'<p class="muted">Chưa tìm thấy bài phù hợp. Thử nới tiêu chí.</p>';}catch(e){alert(e.message)}}
async function loadEvents(){if(!me)return;try{const j=await api('/api/events');const a=j.events||[];$('#eventList').innerHTML=a.map(e=>`<article class="event-card"><div><span class="status-pill">${e.checkedIn?'✅ Đã check-in':e.joined?'🟢 Đã đăng ký':'⚪ Chưa đăng ký'}</span><h3>${esc(e.title)}</h3><p>${esc(e.description||'')}</p><p>🕒 ${fmtDate(e.startAt)}${e.endAt?` → ${fmtDate(e.endAt)}`:''}</p><small>👥 ${(e.participants||[]).length} đăng ký • tạo bởi ${esc(e.createdBy)}</small>${e.checkinCode?`<p class="admin-code">Mã check-in: <b>${esc(e.checkinCode)}</b></p>`:''}</div><div class="event-actions"><button class="tiny" data-action="event-join" data-id="${e.id}">${e.joined?'Hủy đăng ký':'Tham gia'}</button>${e.joined&&!e.checkedIn?`<button class="tiny ghost" data-action="event-checkin" data-id="${e.id}">🎟️ Check-in</button>`:''}${['Boss','Kì Cựu'].includes(me.role)?`<button class="tiny danger" data-action="event-delete" data-id="${e.id}">Xóa</button>`:''}</div></article>`).join('')||'<p class="muted">Chưa có sự kiện.</p>';}catch(e){$('#eventList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function createEvent(){if(!requireOnline('Tạo sự kiện'))return;try{await api('/api/events',{method:'POST',body:JSON.stringify({title:$('#eventTitle').value,description:$('#eventDescription').value,startAt:$('#eventStart').value,endAt:$('#eventEnd').value})});$('#eventTitle').value=$('#eventDescription').value='';await loadEvents();}catch(e){alert(e.message)}}
async function toggleEventJoin(id){if(!requireOnline('Đăng ký sự kiện'))return;try{await api(`/api/events/${id}/join`,{method:'POST',body:'{}'});me=(await api('/api/me')).user;renderProfile();await loadEvents();}catch(e){alert(e.message)}}
async function checkinEvent(id){if(!requireOnline('Check-in sự kiện'))return;const code=prompt('Nhập mã check-in sự kiện:','');if(!code)return;try{await api(`/api/events/${id}/checkin`,{method:'POST',body:JSON.stringify({code})});me=(await api('/api/me')).user;renderProfile();await loadEvents();alert('Check-in thành công +25 XP.');}catch(e){alert(e.message)}}
async function deleteEvent(id){if(!requireOnline('Xóa sự kiện'))return;if(!confirm('Xóa sự kiện này?'))return;try{await api(`/api/events/${id}`,{method:'DELETE'});await loadEvents();}catch(e){alert(e.message)}}
function roundedRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,r):(ctx.rect(x,y,w,h));ctx.fill();}
async function drawProfileCard(){const c=$('#profileCardCanvas');if(!c||!me)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);const g=ctx.createLinearGradient(0,0,c.width,c.height);g.addColorStop(0,'#07111f');g.addColorStop(.55,'#0a3b66');g.addColorStop(1,'#32105e');ctx.fillStyle=g;ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#39b9ff';ctx.lineWidth=5;ctx.strokeRect(20,20,c.width-40,c.height-40);ctx.fillStyle='#fff';ctx.font='bold 48px Segoe UI';ctx.fillText('GiaTộc ┊Name Hub',360,90);ctx.font='bold 56px Segoe UI';ctx.fillText(me.displayName||me.username,360,180);ctx.fillStyle='#7fffe3';ctx.font='bold 28px Segoe UI';ctx.fillText(`${meta(me.role).icon} ${me.role}   •   Level ${me.level||1}   •   ${me.xp||0} XP`,360,230);ctx.fillStyle='#dce9f6';ctx.font='26px Segoe UI';ctx.fillText(`🎮 ${me.games||'Chưa cập nhật game'}`,360,285);ctx.fillText(`🏆 ${(me.achievements||[]).length} thành tích`,360,330);ctx.font='22px Segoe UI';ctx.fillStyle='#b9d7ef';ctx.fillText((me.badges||[]).slice(0,4).map(b=>`${b.icon} ${b.name}`).join('   ')||'🌱 Hoàn thành hoạt động để mở huy hiệu',360,380);try{const img=new Image();img.crossOrigin='anonymous';img.src=avatarOf(me);await img.decode();ctx.save();ctx.beginPath();ctx.arc(190,240,125,0,Math.PI*2);ctx.clip();ctx.drawImage(img,65,115,250,250);ctx.restore();ctx.strokeStyle=meta(me.role).c1;ctx.lineWidth=10;ctx.beginPath();ctx.arc(190,240,130,0,Math.PI*2);ctx.stroke();}catch{}try{const tmp=document.createElement('canvas');await window.QRCode.toCanvas(tmp,$('#profileCardUrl').value||location.origin,{width:180,margin:1});ctx.fillStyle='#fff';ctx.fillRect(930,390,200,200);ctx.drawImage(tmp,940,400,180,180);}catch{}ctx.fillStyle='#72d3ff';ctx.font='22px Segoe UI';ctx.fillText('Quét QR để mở GiaTộc ┊Name Hub',705,605);}
async function loadTwoFactorStatus(){const st=$('#twoFactorStatus');if(!st||!me||!isOnline()){if(st)st.textContent='Cần mạng';return;}try{const j=await api('/api/security/2fa/status');st.textContent=j.enabled?'🟢 Đã bật':'⚪ Chưa bật';}catch(e){st.textContent='Không xác định';}}
async function setupTwoFactor(){if(!requireOnline('Thiết lập 2FA'))return;try{const j=await api('/api/security/2fa/setup',{method:'POST',body:'{}'});$('#twoFactorSetup').hidden=false;$('#twoFactorSecret').textContent=j.secret;await window.QRCode.toDataURL(j.uri,{width:260,margin:2}).then(url=>$('#twoFactorQr').src=url);}catch(e){alert(e.message)}}
async function confirmTwoFactor(){const code=$('#twoFactorCode').value.trim();if(!code)return;try{const j=await api('/api/security/2fa/confirm',{method:'POST',body:JSON.stringify({code})});$('#twoFactorSetup').hidden=true;$('#recoveryCodes').innerHTML=`<h3>🔑 Recovery Codes — lưu ở nơi an toàn</h3><div class="codes-grid">${(j.recoveryCodes||[]).map(c=>`<code>${esc(c)}</code>`).join('')}</div><p class="muted">Mỗi mã chỉ dùng được một lần.</p>`;await loadTwoFactorStatus();me=(await api('/api/me')).user;}catch(e){alert(e.message)}}
async function disableTwoFactor(){if(!requireOnline('Tắt 2FA'))return;const password=prompt('Nhập mật khẩu hiện tại để tắt 2FA:','');if(!password)return;try{await api('/api/security/2fa/disable',{method:'POST',body:JSON.stringify({password})});$('#recoveryCodes').innerHTML='';await loadTwoFactorStatus();me=(await api('/api/me')).user;alert('Đã tắt 2FA.');}catch(e){alert(e.message)}}
async function loadAnalytics(){if(!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline()||!$('#analyticsGrid'))return;try{const j=await api('/api/admin/analytics');const rows=[['👥 Thành viên',j.users],['🟢 Online',j.online5m],['💬 Chat 24h',j.chat24h],['🤝 Bài tìm đội',j.teamOpen],['📅 Sự kiện',j.events],['🎬 Highlights',j.highlights||0],['✦ Prestige',j.prestigeUsers||0],['🏅 Mẫu thành tích',j.achievementTemplates||0],['🚩 Báo cáo mở',j.reportsOpen],['💾 Backup',j.backups],['🗂️ Storage',(j.storageBytes/1024/1024).toFixed(1)+' MB']];$('#analyticsGrid').innerHTML=rows.map(([k,v])=>`<div class="metric"><b>${k}</b><strong>${esc(v)}</strong></div>`).join('');$('#analyticsTopXp').innerHTML=`<h4>🏆 Top XP</h4>${(j.topXp||[]).map((u,i)=>`<div class="top-xp"><span>#${i+1} ${esc(u.displayName)}</span><b>Lv.${u.level} • ${u.xp} XP</b></div>`).join('')}`;}catch(e){$('#analyticsGrid').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}

async function loadNotifications(){ if(!me)return; try{const j=await api('/api/notifications'); const badge=$('#notificationBadge'); if(badge){badge.hidden=!j.unread;badge.textContent=j.unread||0;} const icon=n=>n.type==='achievement'?'🏆':n.type==='mention'?'@':n.type==='reply'?'↩️':n.type==='role'?'👑':n.type==='friend'?'👥':n.type==='dm'?'💬':n.type==='moderation'?'🛡️':'🔔'; $('#notificationList').innerHTML=(j.notifications||[]).map(n=>`<article class="notification-item ${n.read?'read':'unread'}" data-action="open-notification" data-id="${n.id}" data-route="${esc(n.route||'')}" data-room="${esc(n.room||'')}" data-dm="${esc(n.dmUserId||'')}"><div class="notification-icon">${icon(n)}</div><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${fmtDate(n.createdAt)}</small></div></article>`).join('')||'<p class="muted">Chưa có thông báo.</p>'; }catch(e){$('#notificationList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;} }
async function readAllNotifications(){if(!requireOnline('Đánh dấu thông báo'))return;await api('/api/notifications/read',{method:'POST',body:'{}'});loadNotifications();}
async function openNotification(id,route,room,dmUserId=''){ if(isOnline()) await api('/api/notifications/read',{method:'POST',body:JSON.stringify({id})}).catch(()=>{}); if(room){selectedChatRoom=room;if($('#chatRoom'))$('#chatRoom').value=room;} if(dmUserId){selectedDmUserId=dmUserId;routeTo('friends');await loadFriends();await openDM(dmUserId);return;} if(route) routeTo(route); else loadNotifications(); }
async function enablePush(){try{await window.enablePushNotifications?.();await refreshPushStatus();}catch(e){alert(e.message||'Không thể bật thông báo');}}
async function disablePush(){try{await window.disablePushNotifications?.();await refreshPushStatus();}catch(e){alert(e.message||'Không thể tắt thông báo');}}
async function refreshPushStatus(){const el=$('#pushStatus');if(!el)return;try{const s=await window.getPushStatus?.();el.textContent=s?.supported?(s.subscribed?'🟢 Đã bật':s.permission==='denied'?'🔴 Đã chặn':'⚪ Chưa bật'):'Không hỗ trợ';}catch{el.textContent='Không xác định';}}

async function loadFriends(){
  if(!me)return;
  try{
    const [f,m]=await Promise.all([api('/api/friends'),api('/api/members')]);
    friendsState={friends:f.friends||[],incoming:f.incoming||[],outgoing:f.outgoing||[],members:m.members||[]};
    renderFriends();
    if(selectedDmUserId && friendsState.friends.some(x=>x.id===selectedDmUserId)) await loadDM(selectedDmUserId);
  }catch(e){if($('#friendList'))$('#friendList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
function renderFriends(){
  if(!$('#friendList'))return;
  $('#incomingFriendRequests').innerHTML=friendsState.incoming.length?friendsState.incoming.map(r=>`<article class="friend-row">${avatarHTML(r.user)}<div class="friend-main"><b>${esc(r.user.displayName||'Thành viên')}</b><small>@${esc(r.user.username||'')}</small></div><button class="tiny" data-action="friend-accept" data-id="${r.id}">Chấp nhận</button><button class="tiny ghost" data-action="friend-decline" data-id="${r.id}">Từ chối</button></article>`).join(''):'<p class="muted">Không có lời mời mới.</p>';
  $('#friendList').innerHTML=friendsState.friends.length?friendsState.friends.map(u=>`<article class="friend-row">${avatarHTML(u)}<div class="friend-main"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} • ${esc(u.games||'')}</small></div><button class="tiny" data-action="open-dm" data-id="${u.id}">💬 Nhắn tin</button><button class="tiny ghost" data-action="friend-remove" data-id="${u.id}">Hủy bạn</button></article>`).join(''):'<p class="muted">Chưa có bạn bè.</p>';
  renderFriendDirectory();
}
function renderFriendDirectory(){
  const box=$('#friendDirectory');if(!box||!me)return;
  const q=($('#friendSearch')?.value||'').trim().toLowerCase(); const friendIds=new Set(friendsState.friends.map(x=>x.id)); const outIds=new Set(friendsState.outgoing.map(x=>x.user?.id)); const inIds=new Set(friendsState.incoming.map(x=>x.user?.id));
  const list=friendsState.members.filter(u=>u.id!==me.id&&(!q||u.displayName.toLowerCase().includes(q)||u.username.toLowerCase().includes(q))).slice(0,30);
  box.innerHTML=list.length?list.map(u=>`<article class="friend-row">${avatarHTML(u)}<div class="friend-main"><b>${esc(u.displayName)}</b><small>@${esc(u.username)} • ${esc(u.role)}</small></div>${friendIds.has(u.id)?'<span class="status-pill">Bạn bè</span>':outIds.has(u.id)?'<span class="status-pill">Đã gửi</span>':inIds.has(u.id)?'<span class="status-pill">Đã gửi cho bạn</span>':`<button class="tiny" data-action="friend-request" data-id="${u.id}">+ Kết bạn</button>`}<button class="tiny ghost" data-action="report-target" data-type="user" data-id="${u.id}">🚩</button></article>`).join(''):'<p class="muted">Không tìm thấy thành viên.</p>';
}
async function requestFriend(id){if(!requireOnline('Gửi lời mời kết bạn'))return;try{await api(`/api/friends/request/${id}`,{method:'POST',body:'{}'});await loadFriends();}catch(e){alert(e.message)}}
async function acceptFriend(id){if(!requireOnline('Chấp nhận kết bạn'))return;try{await api(`/api/friends/request/${id}/accept`,{method:'POST',body:'{}'});await loadFriends();}catch(e){alert(e.message)}}
async function declineFriend(id){if(!requireOnline('Từ chối lời mời'))return;try{await api(`/api/friends/request/${id}`,{method:'DELETE'});await loadFriends();}catch(e){alert(e.message)}}
async function removeFriend(id){if(!requireOnline('Hủy bạn bè'))return;if(!confirm('Hủy kết bạn?'))return;try{await api(`/api/friends/${id}`,{method:'DELETE'});if(selectedDmUserId===id){selectedDmUserId='';$('#dmMessages').innerHTML='<p class="muted">Chọn một người bạn.</p>';}await loadFriends();}catch(e){alert(e.message)}}
async function openDM(id){selectedDmUserId=id;const u=friendsState.friends.find(x=>x.id===id);if(!u)return;$('#dmHeader').textContent=`💬 ${u.displayName}`;$('#dmState').textContent=isOnline()?'Online':'Offline • chờ đồng bộ';await loadDM(id);$('#dmInput')?.focus();}
async function loadDM(id=selectedDmUserId){if(!id||!me)return;try{const j=await api(`/api/dm/${encodeURIComponent(id)}`);const queued=await window.OfflineDB?.listQueue?.()||[];const pending=queued.filter(x=>x.type==='dm'&&x.url===`/api/dm/${id}`).map(x=>({id:'pending-'+x.id,userId:me.id,toUserId:id,displayName:me.displayName,role:me.role,avatar:me.avatar,text:x.body?.text||'',createdAt:new Date(x.createdAt).toISOString(),mine:true,pending:true}));const all=[...(j.messages||[]),...pending];$('#dmMessages').innerHTML=all.map(m=>`<div class="chat-message ${m.mine?'mine':''} ${m.pending?'pending':''}">${avatarHTML(m)}<div class="chat-bubble"><div class="chat-head"><b>${esc(m.displayName)}</b><small>${m.pending?'⏳ chờ đồng bộ':fmtDate(m.createdAt)}</small></div><p>${esc(m.text)}</p>${!m.mine&&!m.pending?`<button class="tiny ghost" data-action="report-target" data-type="dm" data-id="${m.id}">🚩 Báo cáo</button>`:''}</div></div>`).join('')||'<p class="muted">Chưa có tin nhắn riêng.</p>';const b=$('#dmMessages');b.scrollTop=b.scrollHeight;}catch(e){$('#dmMessages').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function sendDM(){if(!selectedDmUserId)return alert('Chọn một người bạn trước.');const input=$('#dmInput'),text=input.value.trim();if(!text)return;try{const j=await api(`/api/dm/${selectedDmUserId}`,{method:'POST',body:JSON.stringify({text,clientId:uid()}),queueIfOffline:'dm'});input.value='';await loadDM(selectedDmUserId);if(j.queued)await updateOfflineStatus();}catch(e){alert(e.message)}}
async function reportTarget(type,id){if(!requireOnline('Gửi báo cáo'))return;const reason=prompt('Lý do báo cáo:','');if(!reason||reason.trim().length<3)return;try{await api('/api/reports',{method:'POST',body:JSON.stringify({targetType:type,targetId:id,reason})});alert('Đã gửi báo cáo tới quản trị viên.');}catch(e){alert(e.message)}}

async function renderSyncCenter(){const box=$('#syncQueueList');if(!box)return;let items=[];try{items=await window.OfflineDB?.listQueue?.()||[];}catch{}const label={profile:'Hồ sơ',avatar:'Avatar',chat:'Chat',team:'Tìm đồng đội',music:'Âm nhạc',dm:'Tin nhắn riêng'};box.innerHTML=items.length?items.map(x=>`<article class="sync-row ${esc(x.status||'pending')}"><div><b>${x.status==='conflict'?'⚔️ Xung đột':x.status==='error'?'⚠️ Lỗi':'⏳ Chờ'} • ${esc(label[x.type]||x.type)}</b><p>${esc(x.lastError||'Sẵn sàng đồng bộ khi có mạng.')}</p><small>${fmtDate(x.createdAt)}${x.retries?` • thử ${x.retries} lần`:''}</small></div><div class="sync-actions">${x.status==='conflict'?`<button class="tiny" data-action="resolve-local" data-id="${x.id}">Giữ bản thiết bị</button><button class="tiny ghost" data-action="resolve-server" data-id="${x.id}">Giữ bản máy chủ</button>`:`<button class="tiny ghost" data-action="retry-queue" data-id="${x.id}">Thử lại</button>`}<button class="tiny danger" data-action="delete-queue" data-id="${x.id}">Hủy</button></div></article>`).join(''):'<p class="muted">✅ Không có thao tác chờ đồng bộ.</p>';}
async function retryQueueItem(id){await window.OfflineDB?.updateQueue?.(id,{status:'pending',lastError:''});await renderSyncCenter();if(isOnline())await syncOfflineQueue(false);}
async function deleteQueueItemUI(id){if(!confirm('Hủy thao tác đang chờ này?'))return;await window.OfflineDB?.deleteQueue?.(id);await updateOfflineStatus();}
async function resolveConflictLocal(id){const items=await window.OfflineDB?.listQueue?.()||[];const item=items.find(x=>x.id===id);if(!item)return;await window.OfflineDB.updateQueue(id,{status:'pending',lastError:'',body:{...(item.body||{}),force:true}});await syncOfflineQueue(true);}
async function resolveConflictServer(id){const items=await window.OfflineDB?.listQueue?.()||[];const item=items.find(x=>x.id===id);if(!item)return;const current=item.conflictData?.current;if(current){me=current;await snapshotPut('/api/me',{user:me});renderProfile();}await window.OfflineDB.deleteQueue(id);await updateOfflineStatus();alert('Đã giữ bản hồ sơ trên máy chủ.');}

async function loadSessions(){if(!me||!isOnline()){if($('#sessionList'))$('#sessionList').innerHTML='<p class="offline-note">Quản lý phiên cần mạng.</p>';return;}try{const j=await api('/api/security/sessions');$('#sessionList').innerHTML=(j.sessions||[]).map(s=>`<article class="session-item"><div><b>${s.current?'🟢 Thiết bị hiện tại':'📱 Phiên đăng nhập'}</b><p>${esc(s.userAgent)}</p><small>IP ${esc(s.ip||'-')} • hoạt động ${fmtDate(s.lastSeen)}</small></div>${!s.current?`<button class="tiny danger" data-action="revoke-session" data-id="${s.id}">Đăng xuất</button>`:''}</article>`).join('')||'<p class="muted">Không có phiên.</p>';}catch(e){$('#sessionList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function revokeSession(id){if(!requireOnline('Đăng xuất thiết bị'))return;try{await api(`/api/security/sessions/${id}/revoke`,{method:'POST'});loadSessions();}catch(e){alert(e.message)}}
async function changePassword(){if(!requireOnline('Đổi mật khẩu'))return;const a=$('#newPassword').value,b=$('#newPassword2').value;if(a!==b)return alert('Mật khẩu mới nhập lại chưa khớp.');try{await api('/api/security/password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword').value,newPassword:a})});$('#currentPassword').value=$('#newPassword').value=$('#newPassword2').value='';alert('Đã đổi mật khẩu và đăng xuất các thiết bị khác.');loadSessions();}catch(e){alert(e.message)}}

async function adminUsers() {
  if (!me || !['Boss','Kì Cựu'].includes(me.role)) return;
  if (!isOnline()) { if ($('#users')) $('#users').innerHTML = '<p class="offline-note">🟠 Trung tâm quản trị cần mạng để tránh áp dụng dữ liệu cũ.</p>'; return; }
  try { adminCache = (await api('/api/admin/users')).users; renderAdminUsers(); } catch (e) { console.warn(e); }
}
function renderAdminUsers() {
  if (!$('#users') || !me || !['Boss','Kì Cựu'].includes(me.role)) return;
  const q = ($('#adminSearch')?.value || '').trim().toLowerCase(); const a = adminCache.filter(u => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  $('#users').innerHTML = a.length ? a.map(u => { const m = meta(u.role); const muted=u.muteUntil&&new Date(u.muteUntil).getTime()>Date.now(); return `<div class="user role-card-${m.key}">${avatarHTML(u)}<div class="member-info"><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small><span class="mini-role ${m.key}">${m.icon} ${m.label}${u.banned ? ' • ⛔ BANNED' : ''}${muted?' • 🔇 TIMEOUT':''}</span><small>${(u.achievements || []).length} thành tích${muted?` • đến ${fmtDate(u.muteUntil)}`:''}</small></div><div class="admin-actions">${me.role === 'Boss' ? `<select data-change-action="set-role" data-id="${esc(u.id)}" aria-label="Đổi role"><option value="${esc(u.role)}">${esc(u.role)}</option>${['Boss','Kì Cựu','Member'].filter(r => r !== u.role).map(r => `<option value="${r}">${r}</option>`).join('')}</select>` : ''}<button data-action="add-achievement" data-id="${esc(u.id)}">🏆 Thành tích</button><button class="ghost" data-action="mute-user" data-id="${esc(u.id)}">${muted?'🔊 Gỡ Timeout':'🔇 Timeout'}</button><button class="${u.banned ? 'unban' : 'ban'}" data-action="ban-user" data-id="${esc(u.id)}" data-banned="${!u.banned}">${u.banned ? 'Mở cấm' : 'Cấm'}</button></div></div>`; }).join('') : '<p class="muted">Không tìm thấy thành viên phù hợp.</p>';
}
async function addAchievement(id) {
  if (!requireOnline('Trao thành tích')) return;
  const target = adminCache.find(u => u.id === id); const title = prompt(`Tên thành tích cho ${target?.displayName || 'thành viên'}:`); if (!title) return;
  const description = prompt('Mô tả thành tích:', '') || ''; const icon = prompt('Icon/emoji:', '🏆') || '🏆';
  try { await api(`/api/admin/user/${id}/achievement`, { method: 'POST', body: JSON.stringify({ title, description, icon }) }); await adminUsers(); if (id === me.id) { me = (await api('/api/me')).user; renderProfile(); } } catch (e) { alert(e.message); }
}
async function loadLogs() {
  if (!requireOnline('Nhật ký quản trị')) return;
  try { const j = await api('/api/admin/logs'); const box = $('#logs'); box.hidden = !box.hidden; if (box.hidden) return; box.innerHTML = j.logs.length ? j.logs.map(l => `<div class="log-item"><b>${esc(l.action)}</b><span>${esc(l.by || l.user || 'Hệ thống')}${l.target ? ' → ' + esc(l.target) : ''}</span><small>${fmtDate(l.at)}</small></div>`).join('') : '<p class="muted">Chưa có nhật ký.</p>'; } catch (e) { alert(e.message); }
}
async function setRole(id, role) { if (!requireOnline('Đổi Role')) return; await api('/api/admin/user/' + id, { method: 'POST', body: JSON.stringify({ role }) }); if (id === me.id) me = (await api('/api/me')).user; renderProfile(); await Promise.all([adminUsers(), members()]); }
async function ban(id, banned) { if (!requireOnline('Cấm/Mở cấm')) return; if (id === me.id && !confirm('Bạn đang thao tác trên chính tài khoản của mình. Tiếp tục?')) return; await api('/api/admin/user/' + id, { method: 'POST', body: JSON.stringify({ banned }) }); await Promise.all([adminUsers(), members()]); }
async function backup() { if (!requireOnline('Backup')) return; const j = await api('/api/backup', { method: 'POST' }); alert('Đã backup: ' + j.file); await loadBackups(); }
async function muteUser(id){if(!requireOnline('Timeout'))return;const u=adminCache.find(x=>x.id===id);const active=u?.muteUntil&&new Date(u.muteUntil).getTime()>Date.now();if(active){if(!confirm(`Gỡ Timeout cho ${u.displayName}?`))return;await api(`/api/admin/user/${id}/mute`,{method:'POST',body:JSON.stringify({minutes:0})});await adminUsers();return;}const raw=prompt('Timeout bao nhiêu phút? (tối đa 10080 = 7 ngày)','30');if(raw==null)return;const minutes=Number(raw);if(!Number.isFinite(minutes)||minutes<=0)return alert('Số phút không hợp lệ.');const reason=prompt('Lý do Timeout:','Spam / vi phạm nội quy')||'';try{await api(`/api/admin/user/${id}/mute`,{method:'POST',body:JSON.stringify({minutes,reason})});await adminUsers();}catch(e){alert(e.message)}}
async function loadAdminReports(){
  if(!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline())return;
  try{
    const j=await api('/api/admin/reports');
    $('#adminReports').innerHTML=(j.reports||[]).map(r=>`<article class="report-row ${esc(r.status)}"><div><b>🚩 ${esc(r.targetType)} • ${esc(r.status)}</b><p>${esc(r.reason)}</p><small>@${esc(r.reporterUsername||'')} • ${fmtDate(r.createdAt)}${r.assignedTo?` • phụ trách: ${esc(r.assignedTo)}`:''}</small>${r.internalNote?`<p class="internal-note">📝 ${esc(r.internalNote)}</p>`:''}</div><div class="report-actions"><button class="tiny ghost" data-action="workflow-report" data-id="${r.id}" data-status="in_review">Đang xem</button><button class="tiny" data-action="workflow-report" data-id="${r.id}" data-status="resolved">Đã xử lý</button><button class="tiny ghost" data-action="workflow-report" data-id="${r.id}" data-status="dismissed">Bỏ qua</button></div></article>`).join('')||'<p class="muted">Không có báo cáo.</p>';
  }catch(e){$('#adminReports').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
async function resolveReport(id,status){if(!requireOnline('Xử lý báo cáo'))return;try{await api(`/api/admin/reports/${id}/resolve`,{method:'POST',body:JSON.stringify({status})});await loadAdminReports();}catch(e){alert(e.message)}}
async function workflowReport(id,status){
  if(!requireOnline('Cập nhật quy trình báo cáo'))return;
  const assignedTo=prompt('Người phụ trách báo cáo:',me?.username||'') ?? '';
  const internalNote=prompt('Ghi chú nội bộ cho quản trị viên:','') ?? '';
  try{await api(`/api/admin/reports/${id}/workflow`,{method:'POST',body:JSON.stringify({status,assignedTo,internalNote})});await loadAdminReports();await loadAudit();}catch(e){alert(e.message)}
}
async function loadBackups(){if(!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline())return;try{const j=await api('/api/backups');$('#backupPolicy').textContent=`Mỗi ${j.autoHours}h • giữ ${j.keep} bản`;$('#backupList').innerHTML=(j.backups||[]).map(b=>`<article class="backup-row"><div><b>${esc(b.file)}</b><p>${(b.size/1024).toFixed(1)} KB</p><small>${fmtDate(b.createdAt)}</small></div><div class="backup-actions"><button class="tiny" data-action="restore-backup" data-file="${esc(b.file)}">Khôi phục</button><button class="tiny danger" data-action="delete-backup" data-file="${esc(b.file)}">Xóa</button></div></article>`).join('')||'<p class="muted">Chưa có backup.</p>';}catch(e){$('#backupList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function restoreBackup(file){if(!requireOnline('Khôi phục backup'))return;if(!confirm(`Khôi phục ${file}? Hệ thống sẽ tự tạo một backup an toàn trước khi restore.`))return;const password=prompt('Nhập mật khẩu hiện tại để xác nhận Restore:','');if(!password)return;try{const j=await api(`/api/backups/${encodeURIComponent(file)}/restore`,{method:'POST',body:JSON.stringify({password})});alert(`Đã khôi phục ${j.restored}. Backup an toàn: ${j.safetyBackup}. Trang sẽ tải lại.`);location.reload();}catch(e){alert(e.message)}}
async function deleteBackup(file){if(!requireOnline('Xóa backup'))return;if(!confirm(`Xóa ${file}?`))return;try{await api(`/api/backups/${encodeURIComponent(file)}`,{method:'DELETE'});await loadBackups();}catch(e){alert(e.message)}}

function readImage(file, cb) { const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => cb(img); img.src = reader.result; }; reader.readAsDataURL(file); }
function downloadCanvas(id, filename) { const c = document.getElementById(id); if (!c) return; const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = filename; a.click(); }
function loadRoleAvatar() { const f = $('#roleAvatarFile').files[0]; if (!f) return; readImage(f, img => { roleAvatarImg = img; drawRoleAvatar(); }); }
function drawRoleAvatar() {
  const c = $('#roleAvatarCanvas'); if (!c) return; const ctx = c.getContext('2d'); const role = $('#roleAvatarRole')?.value || 'Member'; const m = meta(role); const name = $('#roleAvatarName')?.value || '';
  ctx.clearRect(0,0,512,512); const bg = ctx.createRadialGradient(256,180,40,256,256,360); bg.addColorStop(0,'#132b49'); bg.addColorStop(1,'#050816'); ctx.fillStyle=bg; ctx.fillRect(0,0,512,512);
  ctx.save(); ctx.beginPath(); ctx.arc(256,232,170,0,Math.PI*2); ctx.clip();
  if (roleAvatarImg) { const s=Math.max(340/roleAvatarImg.width,340/roleAvatarImg.height); const w=roleAvatarImg.width*s,h=roleAvatarImg.height*s; ctx.drawImage(roleAvatarImg,256-w/2,232-h/2,w,h); }
  else { const fill=ctx.createLinearGradient(100,80,400,400); fill.addColorStop(0,m.c1); fill.addColorStop(1,m.c2); ctx.fillStyle=fill; ctx.fillRect(86,62,340,340); ctx.font='120px Segoe UI Emoji'; ctx.textAlign='center'; ctx.fillStyle='#07111f'; ctx.fillText(m.icon,256,275); }
  ctx.restore(); ctx.lineWidth=22; const ring=ctx.createLinearGradient(90,60,430,410); ring.addColorStop(0,m.c1); ring.addColorStop(.5,'#ffffff'); ring.addColorStop(1,m.c2); ctx.strokeStyle=ring; ctx.shadowColor=m.c1; ctx.shadowBlur=28; ctx.beginPath(); ctx.arc(256,232,181,0,Math.PI*2); ctx.stroke(); ctx.shadowBlur=0;
  ctx.font='70px Segoe UI Emoji'; ctx.textAlign='center'; ctx.fillText(m.icon,256,79); ctx.fillStyle='#eaf6ff'; ctx.font='bold 29px Segoe UI'; ctx.fillText(name || m.label,256,458); ctx.fillStyle=m.c1; ctx.font='bold 18px Segoe UI'; ctx.fillText(m.label,256,490);
}

async function generateQR() {
  const text = $('#qrText').value.trim(); if (!text) return alert('Nhập nội dung QR trước.'); const size = Number($('#qrSize').value) || 512;
  try {
    if (window.QRCode?.toDataURL) {
      qrBlobUrl = await window.QRCode.toDataURL(text, { width: size, margin: 2, errorCorrectionLevel: 'M' });
      $('#qrPreview').src = qrBlobUrl; $('#qrHint').hidden = true; return;
    }
    if (!isOnline()) throw new Error('Thư viện QR offline chưa được tạo. Hãy chạy npm install rồi deploy lại.');
    const r = await fetch(`/api/tools/qr?text=${encodeURIComponent(text)}&size=${encodeURIComponent(size)}`, { credentials: 'same-origin' });
    if (!r.ok) throw Error((await r.json()).error || 'Không thể tạo QR'); const blob = await r.blob(); if (qrBlobUrl?.startsWith('blob:')) URL.revokeObjectURL(qrBlobUrl); qrBlobUrl = URL.createObjectURL(blob); $('#qrPreview').src = qrBlobUrl; $('#qrHint').hidden = true;
  } catch (e) { alert(e.message); }
}
function downloadQR() { if (!qrBlobUrl) return alert('Tạo QR trước.'); const a=document.createElement('a'); a.href=qrBlobUrl; a.download='giatoc-qr.png'; a.click(); }

function downloadBytes(bytes, filename, type = 'application/pdf') {
  const blob = new Blob([bytes], { type }); const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000);
}
async function postFiles(url, field, files, statusText) {
  const fd = new FormData(); [...files].forEach(f => fd.append(field, f)); $('#pdfStatus').textContent = statusText;
  const r = await fetch(url, { method:'POST', body:fd, credentials: 'same-origin' }); if (!r.ok) { const j = await r.json().catch(()=>({})); throw Error(j.error || 'Không thể xử lý file'); }
  const blob = await r.blob(); const disposition = r.headers.get('Content-Disposition') || ''; const match = disposition.match(/filename="?([^";]+)"?/i); const filename = match?.[1] || 'download.pdf'; const a=document.createElement('a'); const u=URL.createObjectURL(blob); a.href=u; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(u),5000); $('#pdfStatus').textContent = `✅ Hoàn tất: ${filename}`;
}
async function mergePDFsLocal(files) {
  const { PDFDocument } = window.PDFLib; const out = await PDFDocument.create();
  for (const file of [...files]) { const src = await PDFDocument.load(await file.arrayBuffer()); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p)); }
  return out.save({ useObjectStreams: true });
}
async function imagesToPDFLocal(files) {
  const { PDFDocument } = window.PDFLib; const pdf = await PDFDocument.create(); const A4=[595.28,841.89]; const margin=32;
  for (const file of [...files]) {
    const bytes = new Uint8Array(await file.arrayBuffer()); let img;
    if (file.type === 'image/png') img = await pdf.embedPng(bytes); else img = await pdf.embedJpg(bytes);
    const page = pdf.addPage(A4); const scale = Math.min((A4[0]-margin*2)/img.width,(A4[1]-margin*2)/img.height,1); const w=img.width*scale,h=img.height*scale;
    page.drawImage(img,{x:(A4[0]-w)/2,y:(A4[1]-h)/2,width:w,height:h});
  }
  return pdf.save({ useObjectStreams: true });
}
async function compressPDFLocal(file) { const { PDFDocument } = window.PDFLib; const pdf = await PDFDocument.load(await file.arrayBuffer()); return pdf.save({ useObjectStreams: true, addDefaultPage: false }); }
async function mergePDFs() {
  const f=$('#mergePdfFiles').files; if (f.length<2) return alert('Chọn ít nhất 2 PDF.'); $('#pdfStatus').textContent='Đang gộp PDF trên thiết bị...';
  try { if (window.PDFLib) { downloadBytes(await mergePDFsLocal(f),'giatoc-merged.pdf'); $('#pdfStatus').textContent='✅ Đã gộp PDF trên thiết bị, không cần mạng.'; } else if (isOnline()) await postFiles('/api/tools/pdf/merge','pdfs',f,'Đang gộp PDF...'); else throw Error('Thiếu thư viện PDF offline. Hãy chạy npm install rồi deploy lại.'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; }
}
async function imagesToPDF() {
  const f=$('#imagesToPdf').files; if (!f.length) return alert('Chọn ảnh trước.'); $('#pdfStatus').textContent='Đang chuyển ảnh thành PDF trên thiết bị...';
  try { if (window.PDFLib) { downloadBytes(await imagesToPDFLocal(f),'giatoc-images.pdf'); $('#pdfStatus').textContent='✅ Đã tạo PDF trên thiết bị, không cần mạng.'; } else if (isOnline()) await postFiles('/api/tools/pdf/images-to-pdf','images',f,'Đang chuyển ảnh sang PDF...'); else throw Error('Thiếu thư viện PDF offline. Hãy chạy npm install rồi deploy lại.'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; }
}
async function compressPDF() {
  const f=$('#compressPdfFile').files; if (!f.length) return alert('Chọn PDF trước.'); $('#pdfStatus').textContent='Đang tối ưu PDF trên thiết bị...';
  try { if (window.PDFLib) { downloadBytes(await compressPDFLocal(f[0]),'giatoc-optimized.pdf'); $('#pdfStatus').textContent='✅ Đã tối ưu cấu trúc PDF trên thiết bị. Mức giảm dung lượng tùy nội dung.'; } else if (isOnline()) await postFiles('/api/tools/pdf/compress','pdf',f,'Đang tối ưu PDF...'); else throw Error('Thiếu thư viện PDF offline. Hãy chạy npm install rồi deploy lại.'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; }
}

function nextPow2(n){let p=1;while(p<n)p*=2;return p;}
function generateTournament() {
  const names = $('#tournamentPlayers').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,64); if(names.length<2) return alert('Nhập ít nhất 2 người/đội.');
  const slots=nextPow2(names.length); const padded=[...names,...Array(slots-names.length).fill('BYE')]; let rounds=[]; let current=padded;
  while(current.length>=2){ const matches=[]; for(let i=0;i<current.length;i+=2) matches.push([current[i],current[i+1]]); rounds.push(matches); current=Array(matches.length).fill('Chờ kết quả'); }
  $('#tournamentTitle').textContent=$('#tournamentName').value || 'Bảng đấu loại trực tiếp';
  $('#bracket').innerHTML=rounds.map((matches,ri)=>`<div class="round"><h3>${ri===rounds.length-1?'Chung kết':`Vòng ${ri+1}`}</h3>${matches.map((m,mi)=>`<div class="match"><span>${esc(m[0])}</span><b>VS</b><span>${esc(m[1])}</span><small>Trận ${mi+1}</small></div>`).join('')}</div>`).join('');
}

function loadBannerBg(){const f=$('#bannerBg').files[0]; if(!f)return; readImage(f,img=>{bannerBgImg=img;drawBanner();});}
function drawBanner(){
  const c=$('#bannerCanvas'); if(!c)return; const ctx=c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
  if(bannerBgImg){const s=Math.max(c.width/bannerBgImg.width,c.height/bannerBgImg.height);const w=bannerBgImg.width*s,h=bannerBgImg.height*s;ctx.drawImage(bannerBgImg,(c.width-w)/2,(c.height-h)/2,w,h);ctx.fillStyle='rgba(3,8,20,.58)';ctx.fillRect(0,0,c.width,c.height);} else {const g=ctx.createLinearGradient(0,0,c.width,c.height);g.addColorStop(0,'#06101f');g.addColorStop(.45,'#0a3b66');g.addColorStop(1,'#38126c');ctx.fillStyle=g;ctx.fillRect(0,0,c.width,c.height);}
  ctx.strokeStyle='#39b9ff';ctx.lineWidth=5;ctx.strokeRect(18,18,c.width-36,c.height-36);ctx.fillStyle='#72d3ff';ctx.font='bold 34px Segoe UI';ctx.fillText($('#bannerName').value||'GiaTộc ┊Name',65,75);ctx.fillStyle='#fff';ctx.font='bold 64px Segoe UI';ctx.fillText($('#bannerText').value||'TUYỂN THÀNH VIÊN',65,160);ctx.fillStyle='#cfeeff';ctx.font='bold 30px Segoe UI';ctx.fillText($('#bannerGame').value||'CỘNG ĐỒNG GAME',68,210);ctx.fillStyle='#dce9f6';ctx.font='25px Segoe UI';wrapCanvasText(ctx,$('#bannerReq').value||'Hoạt động vui vẻ • Tôn trọng cộng đồng • Chơi cùng nhau',68,264,1120,34);ctx.fillStyle='#7fffe3';ctx.font='bold 25px Segoe UI';ctx.fillText('Liên hệ: '+($('#bannerContact').value||'GiaTộc ┊Name Hub'),68,352);ctx.font='80px Segoe UI Emoji';ctx.fillText('🎮',1435,125);ctx.fillText('⚡',1435,240);
}
function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(/\s+/);let line='';for(const w of words){const test=line+w+' ';if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=w+' ';y+=lineHeight;}else line=test;}ctx.fillText(line,x,y);}

function loadImageTool(){const f=$('#imageToolFile').files[0];if(!f)return;readImage(f,img=>{imageToolImg=img;imageToolRotation=0;$('#cropX').value=0;$('#cropY').value=0;$('#cropW').value=img.width;$('#cropH').value=img.height;renderImageTool();});}
function rotateImage(deg){imageToolRotation=(imageToolRotation+deg)%360;renderImageTool();}
function renderImageTool(){
  const c=$('#imageToolCanvas');if(!c||!imageToolImg)return;const sx=Math.max(0,Number($('#cropX').value)||0),sy=Math.max(0,Number($('#cropY').value)||0),sw=Math.min(imageToolImg.width-sx,Math.max(1,Number($('#cropW').value)||imageToolImg.width)),sh=Math.min(imageToolImg.height-sy,Math.max(1,Number($('#cropH').value)||imageToolImg.height));const rot=((imageToolRotation%360)+360)%360; const swap=rot===90||rot===270;c.width=swap?sh:sw;c.height=swap?sw:sh;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.save();if(rot===90){ctx.translate(c.width,0);ctx.rotate(Math.PI/2);}else if(rot===180){ctx.translate(c.width,c.height);ctx.rotate(Math.PI);}else if(rot===270){ctx.translate(0,c.height);ctx.rotate(-Math.PI/2);}ctx.drawImage(imageToolImg,sx,sy,sw,sh,0,0,sw,sh);ctx.restore();const wm=$('#watermarkText').value.trim();if(wm){const font=Math.max(20,Math.round(Math.min(c.width,c.height)*.05));ctx.font=`bold ${font}px Segoe UI`;ctx.textAlign='right';ctx.textBaseline='bottom';ctx.fillStyle='rgba(255,255,255,.76)';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=5;ctx.fillText(wm,c.width-18,c.height-15);ctx.shadowBlur=0;}}
function downloadEditedImage(){const c=$('#imageToolCanvas');if(!imageToolImg)return alert('Chọn ảnh trước.');renderImageTool();const type=$('#imageFormat').value;const quality=Number($('#imageQuality').value)||.9;const ext=type==='image/png'?'png':type==='image/webp'?'webp':'jpg';const a=document.createElement('a');a.href=c.toDataURL(type,quality);a.download=`giatoc-edited.${ext}`;a.click();}


// ===== v1.7 Unique Community =====
async function loadCommunityPulse(){if(!me||!$('#communityPulse'))return;try{const j=await api('/api/community-pulse');const hot=(j.hotGames||[]).map(x=>`${esc(x.game)} (${x.count})`).join(' • ')||'Chưa có';const next=(j.upcoming||[])[0];$('#communityPulse').innerHTML=`<div class="pulse-metric"><strong>${j.online||0}</strong><span>🟢 Online</span></div><div class="pulse-metric"><strong>${j.looking||0}</strong><span>🎯 Đang tìm đội</span></div><div class="pulse-metric"><strong>${j.chat24h||0}</strong><span>💬 Chat 24h</span></div><div class="pulse-wide"><b>🔥 Đang nổi:</b> ${hot}</div><div class="pulse-wide"><b>📅 Sắp tới:</b> ${next?`${esc(next.title)} • ${fmtDate(next.startAt)}`:'Chưa có sự kiện'}</div>`;}catch(e){$('#communityPulse').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}

async function loadHighlights(){if(!me||!$('#highlightList'))return;try{const j=await api('/api/highlights');const list=j.highlights||[];me.highlights=list.slice().reverse();$('#highlightList').innerHTML=list.map(h=>`<article class="highlight-card"><div class="highlight-media">${/^\/uploads\//.test(h.url)||/^https?:/.test(h.url)?`<img src="${esc(h.url)}" alt="${esc(h.title)}" loading="lazy">`:''}</div><div><span class="status-pill">${esc(h.game||'Highlight')}</span><h3>${esc(h.title)}</h3><p>${esc(h.note||'')}</p><small>${fmtDate(h.createdAt)}</small><button class="tiny danger" data-action="delete-highlight" data-id="${h.id}">Xóa</button></div></article>`).join('')||'<p class="muted">Chưa có highlight. Lưu khoảnh khắc đầu tiên của bạn.</p>';renderProfileShowcase();}catch(e){$('#highlightList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function addHighlight(){if(!requireOnline('Lưu Highlight'))return;const fd=new FormData();fd.append('title',$('#highlightTitle').value);fd.append('game',$('#highlightGame').value);fd.append('note',$('#highlightNote').value);fd.append('externalUrl',$('#highlightUrl').value);const f=$('#highlightImage').files[0];if(f)fd.append('image',f);const r=await fetch('/api/highlights',{method:'POST',body:fd,credentials:'same-origin'});const j=await r.json().catch(()=>({}));if(!r.ok)return alert(j.error||'Không thể lưu highlight');me=j.user||me;renderProfile();$('#highlightTitle').value=$('#highlightNote').value=$('#highlightUrl').value='';$('#highlightImage').value='';await loadHighlights();}
async function deleteHighlight(id){if(!requireOnline('Xóa Highlight'))return;if(!confirm('Xóa highlight này?'))return;try{await api('/api/highlights/'+id,{method:'DELETE'});await loadHighlights();}catch(e){alert(e.message)}}

function renderProfileShowcase(){if(!me||!$('#profileShowcase'))return;const m=meta(me.role),high=(me.highlights||[]).slice(0,6);$('#profileShowcase').innerHTML=`<div class="showcase-hero ${auraClass(me)}"><div class="showcase-profile">${avatarHTML(me,'hero')}<div><span class="role role-${m.key}">${m.icon} ${esc(me.role)}</span><h2>${esc(me.displayName)}</h2><p>${esc(me.bio||'Chưa có giới thiệu.')}</p><div class="showcase-stats"><span>Level ${me.level||1}</span><span>${me.xp||0} XP</span><span>✦ Prestige ${me.prestige||0}</span><span>🏆 ${(me.achievements||[]).length}</span></div></div></div><div class="badge-list">${(me.badges||[]).map(b=>`<span class="badge-chip">${esc(b.icon||'🏅')} ${esc(b.name)}</span>`).join('')}</div></div><div class="showcase-grid">${high.map(h=>`<article><img src="${esc(h.url)}" alt="${esc(h.title)}"><b>${esc(h.title)}</b><small>${esc(h.game||'')}</small></article>`).join('')||'<p class="muted">Highlight Vault sẽ tự xuất hiện tại đây.</p>'}</div>`;}

function renderToolboxOptions(){if(!me||!$('#toolboxOptions'))return;const selected=new Set(me.toolbox||[]);$('#toolboxOptions').innerHTML=TOOLBOX_ITEMS.map(([route,label])=>`<label class="toolbox-option"><input type="checkbox" value="${route}" ${selected.has(route)?'checked':''}> <span>${label}</span></label>`).join('');}
function renderPersonalToolbox(){if(!me||!$('#personalToolbox'))return;const selected=new Set(me.toolbox||[]);const items=TOOLBOX_ITEMS.filter(([r])=>selected.has(r)).slice(0,6);$('#personalToolbox').innerHTML=items.map(([route,label])=>`<button data-go="${route}">${label}</button>`).join('')||'<p class="muted">Chưa ghim công cụ. Bấm Tùy chỉnh.</p>';}
async function saveToolbox(){const selected=$$('#toolboxOptions input:checked').map(x=>x.value).slice(0,6);if(!selected.length)return alert('Chọn ít nhất 1 mục.');const payload={displayName:me.displayName,bio:me.bio,games:me.games,gameId:me.gameId,discord:me.discord,auraStatus:me.auraStatus,playStyle:me.playStyle,availabilityStart:me.availabilityStart,availabilityEnd:me.availabilityEnd,availabilityDays:me.availabilityDays||[],toolbox:selected,baseUpdatedAt:me.profileUpdatedAt||''};try{const j=await api('/api/profile',{method:'POST',body:JSON.stringify(payload)});me=j.user;renderProfile();renderPersonalToolbox();alert('Đã lưu Personal Toolbox.');}catch(e){alert(e.message)}}

async function prestige(){if(!requireOnline('Prestige'))return;if(!confirm('Prestige sẽ đưa XP về 0, giữ thành tích và tặng huy hiệu Prestige. Tiếp tục?'))return;try{const j=await api('/api/prestige',{method:'POST',body:'{}'});me=j.user;renderProfile();renderProfileShowcase();alert(`Prestige ${me.prestige} thành công!`);}catch(e){alert(e.message)}}

async function loadAchievementTemplates(){if(!me||!['Boss','Kì Cựu'].includes(me.role)||!$('#achievementTemplateList'))return;try{const j=await api('/api/admin/achievement-templates');$('#achievementTemplateList').innerHTML=(j.templates||[]).map(t=>`<article class="template-row rarity-${String(t.rarity).toLowerCase()}"><div><b>${esc(t.icon)} ${esc(t.title)}</b><p>${esc(t.description||'')}</p><small>${esc(t.rarity)} • +${t.xp||0} XP</small></div><div class="compact-actions"><button class="tiny" data-action="award-achievement-template" data-id="${t.id}">Trao</button><button class="tiny danger" data-action="delete-achievement-template" data-id="${t.id}">Xóa</button></div></article>`).join('')||'<p class="muted">Chưa có mẫu thành tích.</p>';}catch(e){$('#achievementTemplateList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function createAchievementTemplate(){if(!requireOnline('Tạo mẫu thành tích'))return;try{await api('/api/admin/achievement-templates',{method:'POST',body:JSON.stringify({icon:$('#achTemplateIcon').value,title:$('#achTemplateTitle').value,rarity:$('#achTemplateRarity').value,xp:Number($('#achTemplateXp').value)||0,description:$('#achTemplateDescription').value})});$('#achTemplateTitle').value=$('#achTemplateDescription').value='';await loadAchievementTemplates();}catch(e){alert(e.message)}}
async function deleteAchievementTemplate(id){if(!requireOnline('Xóa mẫu thành tích'))return;if(!confirm('Xóa mẫu này?'))return;try{await api('/api/admin/achievement-templates/'+id,{method:'DELETE'});await loadAchievementTemplates();}catch(e){alert(e.message)}}
async function awardAchievementTemplate(id){if(!requireOnline('Trao thành tích'))return;const q=prompt('Nhập username của thành viên nhận thành tích:','');if(!q)return;const target=adminCache.find(u=>u.username.toLowerCase()===q.trim().toLowerCase()||u.displayName.toLowerCase()===q.trim().toLowerCase());if(!target)return alert('Không tìm thấy thành viên trong danh sách quản trị.');try{await api(`/api/admin/achievement-templates/${id}/award/${target.id}`,{method:'POST',body:'{}'});alert('Đã trao thành tích.');await adminUsers();}catch(e){alert(e.message)}}


// ===== v1.9 Phòng voice WebRTC + tối ưu chạy nền =====
const voiceState = {
  ws:null, localStream:null, roomId:'', roomPin:'', room:null, self:null, peers:new Map(), muted:false, deafened:false,
  manualLeave:false, reconnectTimer:null, reconnectAttempts:0, selectedMicId:'', iceServers:[], maxParticipants:6, configLoaded:false, turnConfigured:false, audioContext:null, audioBlocked:false,
  relayEnabled:true, relayActive:false, relayTimer:null, relayProcessor:null, relaySource:null, relaySilentGain:null, relayPlayHeads:new Map(), relaySampleRate:16000
};
function voiceStatus(text, mode='normal'){
  const el=$('#voiceConnectionState'); if(el){el.textContent=text;el.classList.toggle('offline-ready',mode==='ok');}
  if($('#voiceMiniState'))$('#voiceMiniState').textContent=text;
}
function voiceSend(payload){if(voiceState.ws?.readyState===WebSocket.OPEN)voiceState.ws.send(JSON.stringify(payload));}
async function ensureVoiceConfig(){
  if(voiceState.configLoaded)return;const cfg=await api('/api/voice/config');voiceState.iceServers=cfg.iceServers||[];voiceState.maxParticipants=cfg.maxParticipants||6;voiceState.turnConfigured=!!cfg.turnConfigured;voiceState.relayEnabled=cfg.relayFallback!==false;voiceState.configLoaded=true;const input=$('#voiceMaxParticipants');if(input){input.max=String(voiceState.maxParticipants);if(Number(input.value)>voiceState.maxParticipants)input.value=String(voiceState.maxParticipants);}
}
function voicePeerLabel(peer){const m=meta(peer.role);return `${m.icon} ${peer.displayName||peer.username}`;}
function renderVoiceParticipants(){
  const box=$('#voiceParticipants'); if(!box)return; const rows=[];
  if(voiceState.self) rows.push({...voiceState.self,connectionId:'self',muted:voiceState.muted,deafened:voiceState.deafened,isSelf:true});
  for(const item of voiceState.peers.values()) rows.push({...item.meta,isSelf:false});
  box.innerHTML=rows.map(peer=>`<article class="voice-person ${peer.muted?'is-muted':''}">${avatarHTML(peer)}<div><b>${esc(voicePeerLabel(peer))}${peer.isSelf?' • Bạn':''}</b><small>${peer.muted?'🔇 Mic tắt':'🎤 Mic bật'}${peer.deafened?' • 🔕 Không nghe phòng':''}</small></div><span class="voice-dot ${peer.muted?'muted':'live'}"></span></article>`).join('')||'<p class="muted">Chưa có thành viên trong phòng.</p>';
  const count=rows.length;if($('#voiceMiniState')&&voiceState.room)$('#voiceMiniState').textContent=`${count}/${voiceState.room.maxParticipants} người`;
}
function renderVoiceRoomState(){
  const current=$('#voiceCurrentRoom'),mini=$('#voiceMiniBar');const active=!!voiceState.roomId;
  if(current)current.hidden=!active;if(mini)mini.hidden=!active;
  if(!active)return;
  if($('#voiceCurrentTitle'))$('#voiceCurrentTitle').textContent=`🎧 ${voiceState.room?.name||'Phòng voice'}`;
  if($('#voiceCurrentMeta'))$('#voiceCurrentMeta').textContent=`${voiceState.room?.game||'Chơi game cùng'} • ${voiceState.room?.locked?'🔒 Có mã':'🌐 Công khai'} • tối đa ${voiceState.room?.maxParticipants||voiceState.maxParticipants} người`;
  if($('#voiceMiniRoom'))$('#voiceMiniRoom').textContent=voiceState.room?.name||'Phòng voice';
  const muteText=voiceState.muted?'🎤 Bật mic':'🎤 Tắt mic',deafText=voiceState.deafened?'🔊 Bật âm thanh phòng':'🔊 Tắt âm thanh phòng';
  $$('[data-action="voice-toggle-mute"]').forEach(b=>b.textContent=muteText);if($('#voiceDeafenBtn'))$('#voiceDeafenBtn').textContent=deafText;
  renderVoiceParticipants();updatePerformanceUi();
}
async function loadVoiceRooms(){
  const box=$('#voiceRoomList');if(!box||!me)return;if(!isOnline()){box.innerHTML='<p class="offline-note">Phòng voice cần kết nối mạng.</p>';return;}
  try{await ensureVoiceConfig();const j=await api('/api/voice/rooms');const rooms=j.rooms||[];$('#voiceRoomCount').textContent=`${rooms.length} phòng`;box.innerHTML=rooms.map(r=>`<article class="voice-room-card"><div><div class="match-meta"><span>${esc(r.game||'Game')}</span><span>${r.locked?'🔒 Có mã':'🌐 Công khai'}</span></div><h3>${esc(r.name)}</h3><p>${r.participants}/${r.maxParticipants} người • tạo bởi @${esc(r.ownerUsername||'')}</p></div><div class="compact-actions"><button data-action="voice-join-room" data-id="${esc(r.id)}" data-locked="${r.locked?'true':'false'}" ${r.participants>=r.maxParticipants?'disabled':''}>🎧 Tham gia</button>${(me.username===r.ownerUsername||['Boss','Kì Cựu'].includes(me.role))?`<button class="ghost danger-outline tiny" data-action="voice-close-room" data-id="${esc(r.id)}">Đóng</button>`:''}</div></article>`).join('')||'<p class="muted">Chưa có phòng voice. Bạn có thể tạo phòng đầu tiên.</p>';}
  catch(e){box.innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
function stopVoiceRoomRefresh(){if(voiceRoomTimer)clearTimeout(voiceRoomTimer);voiceRoomTimer=null;}
function startVoiceRoomRefresh(){stopVoiceRoomRefresh();const tick=async()=>{if(activeRoute!=='voice'||document.hidden)return;await loadVoiceRooms();voiceRoomTimer=setTimeout(tick,10000);};voiceRoomTimer=setTimeout(tick,10000);}
async function createVoiceRoom(){
  if(!requireOnline('Tạo phòng voice'))return;
  try{const payload={name:$('#voiceRoomName').value,game:$('#voiceGame').value,maxParticipants:Number($('#voiceMaxParticipants').value)||6,pin:$('#voiceRoomPin').value};const j=await api('/api/voice/rooms',{method:'POST',body:JSON.stringify(payload)});$('#voiceRoomName').value='';$('#voiceRoomPin').value='';await loadVoiceRooms();await joinVoiceRoom(j.room.id,!!j.room.locked,payload.pin);}
  catch(e){alert(e.message);}
}
async function closeVoiceRoom(id){if(!requireOnline('Đóng phòng voice'))return;if(!confirm('Đóng phòng voice này? Thành viên trong phòng sẽ bị ngắt kết nối.'))return;try{await api('/api/voice/rooms/'+encodeURIComponent(id),{method:'DELETE'});if(voiceState.roomId===id)await leaveVoiceRoom(true);await loadVoiceRooms();}catch(e){alert(e.message)}}
function voiceAudioConstraints(deviceId=''){
  return {audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1,sampleRate:{ideal:48000},...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false};
}
async function ensureVoiceMicrophone(deviceId=voiceState.selectedMicId){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Trình duyệt này không hỗ trợ micro WebRTC.');
  if(location.protocol!=='https:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')throw new Error('Voice cần HTTPS (hoặc localhost) để sử dụng micro.');
  if(voiceState.localStream)return voiceState.localStream;
  voiceState.localStream=await navigator.mediaDevices.getUserMedia(voiceAudioConstraints(deviceId));
  voiceState.localStream.getAudioTracks().forEach(t=>t.enabled=!voiceState.muted);await populateVoiceMicrophones();return voiceState.localStream;
}
async function populateVoiceMicrophones(){
  const sel=$('#voiceMicSelect');if(!sel||!navigator.mediaDevices?.enumerateDevices)return;try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');const current=voiceState.selectedMicId||voiceState.localStream?.getAudioTracks?.()[0]?.getSettings?.().deviceId||'';sel.innerHTML='<option value="">Micro mặc định</option>'+devices.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`Micro ${i+1}`)}</option>`).join('');sel.value=current||'';}catch{}}
async function changeVoiceMicrophone(){
  const id=$('#voiceMicSelect')?.value||'';voiceState.selectedMicId=id;if(!voiceState.roomId)return;
  try{const next=await navigator.mediaDevices.getUserMedia(voiceAudioConstraints(id));const track=next.getAudioTracks()[0];track.enabled=!voiceState.muted;for(const item of voiceState.peers.values()){const sender=item.pc?.getSenders?.().find(s=>s.track?.kind==='audio');if(sender)await sender.replaceTrack(track);}voiceState.localStream?.getTracks().forEach(t=>t.stop());voiceState.localStream=next;if(voiceState.relayActive)await restartVoiceRelayCapture();await populateVoiceMicrophones();}
  catch(e){alert('Không đổi được micro: '+e.message);}
}
function setVoiceAudioBlocked(blocked, message=''){
  voiceState.audioBlocked=!!blocked;
  const btn=$('#voiceEnableAudioBtn');if(btn)btn.hidden=!blocked||voiceState.deafened;
  const hint=$('#voiceQualityHint');if(hint&&message)hint.textContent=message;
}
async function unlockVoiceAudio(){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC){voiceState.audioContext=voiceState.audioContext||new AC();if(voiceState.audioContext.state==='suspended')await voiceState.audioContext.resume();}
    if(voiceState.relayActive){setVoiceAudioBlocked(false,'🟢 Âm thanh đã bật • Relay máy chủ');updateVoiceConnectionHint();return;}
    let blocked=0,played=0;
    for(const item of voiceState.peers.values()){
      const audio=item.audioEl;if(!audio)continue;
      audio.muted=voiceState.deafened;audio.volume=1;
      if(!voiceState.deafened){try{await audio.play();played++;}catch{blocked++;}}
    }
    setVoiceAudioBlocked(blocked>0,blocked?'🔴 Trình duyệt đang chặn âm thanh':'🟢 Âm thanh đã bật');
    if(!blocked&&played&&$('#voiceQualityHint'))$('#voiceQualityHint').textContent='🟢 Âm thanh đã bật';
  }catch(e){setVoiceAudioBlocked(true,'🔴 Không bật được âm thanh');console.warn('Voice audio unlock:',e);}
}
function clearVoiceRelayTimer(){if(voiceState.relayTimer)clearTimeout(voiceState.relayTimer);voiceState.relayTimer=null;}
function updateVoiceConnectionHint(){
  const hint=$('#voiceQualityHint');if(!hint)return;
  if(voiceState.relayActive){hint.textContent='🟢 Âm thanh đã kết nối • Relay máy chủ';return;}
  if(voiceState.audioBlocked&&!voiceState.deafened){hint.textContent='🔴 Cần bấm Bật nghe';return;}
  const states=[...voiceState.peers.values()].map(x=>x.pc?.iceConnectionState||'new');
  if(!states.length){hint.textContent=voiceState.turnConfigured?'WebRTC • TURN sẵn sàng':'WebRTC P2P • STUN';return;}
  if(states.every(s=>s==='connected'||s==='completed')){clearVoiceRelayTimer();hint.textContent='🟢 Âm thanh đã kết nối';return;}
  if(states.some(s=>s==='failed')){hint.textContent=voiceState.relayEnabled?'🟠 P2P thất bại • chuyển Relay...':(voiceState.turnConfigured?'🔴 Kết nối âm thanh thất bại':'🔴 Không nối được P2P • cần TURN');if(voiceState.relayEnabled)startVoiceRelayFallback('ice-failed');return;}
  if(states.some(s=>s==='disconnected')){hint.textContent='🟠 Âm thanh đang mất kết nối';scheduleVoiceRelayFallback(3500);return;}
  if(states.some(s=>s==='checking'||s==='new')){hint.textContent='🟡 Đang nối âm thanh...';scheduleVoiceRelayFallback(8000);return;}
}
function destroyVoicePeers(){for(const item of voiceState.peers.values()){try{item.pc?.close?.();}catch{}if(item.audioEl)try{item.audioEl.remove();}catch{}}voiceState.peers.clear();setVoiceAudioBlocked(false);renderVoiceParticipants();updateVoiceConnectionHint();}
function ensureVoiceAudioContext(){
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
  voiceState.audioContext=voiceState.audioContext||new AC({latencyHint:'interactive'});
  if(voiceState.audioContext.state==='suspended')voiceState.audioContext.resume().catch(()=>setVoiceAudioBlocked(true,'🔴 Bấm Bật nghe để mở âm thanh'));
  return voiceState.audioContext;
}
function downsampleVoiceBuffer(input,inputRate,outputRate=16000){
  if(!input?.length)return new Int16Array(0);const ratio=inputRate/outputRate;const outLen=Math.max(1,Math.floor(input.length/ratio));const out=new Int16Array(outLen);
  for(let i=0;i<outLen;i++){const start=Math.floor(i*ratio),finish=Math.min(input.length,Math.floor((i+1)*ratio));let sum=0,count=0;for(let j=start;j<finish;j++){sum+=input[j];count++;}const sample=Math.max(-1,Math.min(1,count?sum/count:input[start]||0));out[i]=sample<0?sample*0x8000:sample*0x7fff;}
  return out;
}
async function stopVoiceRelayCapture(){
  clearVoiceRelayTimer();try{if(voiceState.relayProcessor)voiceState.relayProcessor.onaudioprocess=null;}catch{}
  for(const node of [voiceState.relaySource,voiceState.relayProcessor,voiceState.relaySilentGain]){try{node?.disconnect?.();}catch{}}
  voiceState.relaySource=null;voiceState.relayProcessor=null;voiceState.relaySilentGain=null;
}
async function restartVoiceRelayCapture(){if(!voiceState.relayActive)return;await stopVoiceRelayCapture();voiceState.relayActive=true;await startVoiceRelayCapture();}
async function startVoiceRelayCapture(){
  if(!voiceState.relayActive||!voiceState.localStream)return;const ctx=ensureVoiceAudioContext();if(!ctx)return;
  try{
    const source=ctx.createMediaStreamSource(voiceState.localStream);const processor=ctx.createScriptProcessor(2048,1,1);const silent=ctx.createGain();silent.gain.value=0;
    processor.onaudioprocess=e=>{if(!voiceState.relayActive||voiceState.muted||voiceState.ws?.readyState!==WebSocket.OPEN)return;const input=e.inputBuffer.getChannelData(0);const pcm=downsampleVoiceBuffer(input,ctx.sampleRate,voiceState.relaySampleRate);if(pcm.byteLength)try{voiceState.ws.send(pcm.buffer);}catch{}};
    source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);voiceState.relaySource=source;voiceState.relayProcessor=processor;voiceState.relaySilentGain=silent;
  }catch(e){console.warn('Voice relay capture:',e);setVoiceAudioBlocked(true,'🔴 Không mở được Relay âm thanh');}
}
async function startVoiceRelayFallback(reason='timeout'){
  if(!voiceState.relayEnabled||voiceState.relayActive||!voiceState.roomId||voiceState.ws?.readyState!==WebSocket.OPEN||!voiceState.peers.size)return;
  clearVoiceRelayTimer();voiceState.relayActive=true;voiceState.relayPlayHeads.clear();ensureVoiceAudioContext();
  for(const item of voiceState.peers.values()){try{item.pc?.close?.();}catch{}item.pc=null;if(item.audioEl){try{item.audioEl.remove();}catch{}item.audioEl=null;}}
  await startVoiceRelayCapture();setVoiceAudioBlocked(false);voiceStatus('🟢 Đã vào phòng • Relay','ok');updateVoiceConnectionHint();renderVoiceParticipants();
  console.info('Voice switched to WebSocket relay:',reason);
}
function scheduleVoiceRelayFallback(delay=8000){
  if(!voiceState.relayEnabled||voiceState.relayActive||voiceState.relayTimer||!voiceState.roomId||!voiceState.peers.size)return;
  voiceState.relayTimer=setTimeout(()=>{voiceState.relayTimer=null;const states=[...voiceState.peers.values()].map(x=>x.pc?.iceConnectionState||'new');if(states.some(s=>!['connected','completed'].includes(s)))startVoiceRelayFallback('ice-timeout');},delay);
}
async function handleVoiceRelayPacket(data){
  if(voiceState.deafened||!voiceState.roomId)return;let ab=data;if(data instanceof Blob)ab=await data.arrayBuffer();if(!(ab instanceof ArrayBuffer)||ab.byteLength<=36)return;
  if(!voiceState.relayActive)await startVoiceRelayFallback('remote-relay');const ctx=ensureVoiceAudioContext();if(!ctx||ctx.state==='suspended'){setVoiceAudioBlocked(true,'🔴 Bấm Bật nghe để mở âm thanh');return;}
  const bytes=new Uint8Array(ab);const senderId=new TextDecoder().decode(bytes.slice(0,36)).trim();if(!senderId||senderId===voiceState.self?.connectionId)return;
  const payload=ab.slice(36);if(payload.byteLength%2)return;const pcm=new Int16Array(payload);if(!pcm.length)return;
  const audioBuffer=ctx.createBuffer(1,pcm.length,voiceState.relaySampleRate);const channel=audioBuffer.getChannelData(0);for(let i=0;i<pcm.length;i++)channel[i]=pcm[i]/32768;
  const source=ctx.createBufferSource();source.buffer=audioBuffer;source.connect(ctx.destination);const now=ctx.currentTime;let next=voiceState.relayPlayHeads.get(senderId)||now+0.07;if(next<now||next>now+0.45)next=now+0.07;source.start(next);voiceState.relayPlayHeads.set(senderId,next+audioBuffer.duration);setVoiceAudioBlocked(false);updateVoiceConnectionHint();
}
async function createVoicePeer(metaPeer, initiator=false){
  if(!metaPeer?.connectionId||voiceState.peers.has(metaPeer.connectionId))return voiceState.peers.get(metaPeer?.connectionId);
  if(voiceState.relayActive){const item={pc:null,meta:{...metaPeer},audioEl:null,pendingCandidates:[]};voiceState.peers.set(metaPeer.connectionId,item);renderVoiceParticipants();return item;}
  const pc=new RTCPeerConnection({iceServers:voiceState.iceServers,bundlePolicy:'max-bundle',iceCandidatePoolSize:4,iceTransportPolicy:'all',rtcpMuxPolicy:'require'});const item={pc,meta:{...metaPeer},audioEl:null,pendingCandidates:[]};voiceState.peers.set(metaPeer.connectionId,item);
  for(const track of voiceState.localStream?.getAudioTracks?.()||[]){const sender=pc.addTrack(track,voiceState.localStream);try{const params=sender.getParameters();params.encodings=params.encodings?.length?params.encodings:[{}];params.encodings[0].maxBitrate=64000;await sender.setParameters(params);}catch{}}
  pc.onicecandidate=e=>{if(e.candidate)voiceSend({type:'signal',target:metaPeer.connectionId,data:{candidate:e.candidate.toJSON?.()||e.candidate}});};
  pc.ontrack=e=>{let audio=item.audioEl;if(!audio){audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;audio.controls=false;audio.preload='auto';audio.muted=voiceState.deafened;audio.volume=1;audio.dataset.peer=metaPeer.connectionId;$('#voiceRemoteAudio')?.appendChild(audio);item.audioEl=audio;}audio.srcObject=e.streams?.[0]||new MediaStream([e.track]);audio.muted=voiceState.deafened;audio.play().then(()=>{setVoiceAudioBlocked(false);updateVoiceConnectionHint();}).catch(()=>{setVoiceAudioBlocked(true,'🔴 Trình duyệt chặn âm thanh • bấm Bật nghe');});};
  pc.oniceconnectionstatechange=()=>{item.iceState=pc.iceConnectionState;updateVoiceConnectionHint();};
  pc.onconnectionstatechange=()=>{if(pc.connectionState==='failed'&&!voiceState.turnConfigured){setVoiceAudioBlocked(false,'🔴 Không nối được P2P • cần TURN');}if(pc.connectionState==='closed'){try{pc.close();}catch{}}renderVoiceParticipants();updateVoiceConnectionHint();};
  if(initiator){const offer=await pc.createOffer({offerToReceiveAudio:true});await pc.setLocalDescription(offer);voiceSend({type:'signal',target:metaPeer.connectionId,data:{description:pc.localDescription.toJSON?.()||pc.localDescription}});}
  renderVoiceParticipants();scheduleVoiceRelayFallback();return item;
}
async function handleVoiceSignal(from,data){
  if(voiceState.relayActive)return;let item=voiceState.peers.get(from);if(!item){item=await createVoicePeer({connectionId:from,displayName:'Thành viên',username:'',role:'Member'},false);}const pc=item?.pc;if(!pc)return;
  try{
    if(data.description){const desc=data.description;await pc.setRemoteDescription(desc);while(item.pendingCandidates.length)await pc.addIceCandidate(item.pendingCandidates.shift()).catch(()=>{});if(desc.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);voiceSend({type:'signal',target:from,data:{description:pc.localDescription.toJSON?.()||pc.localDescription}});}}
    if(data.candidate){if(pc.remoteDescription)await pc.addIceCandidate(data.candidate).catch(()=>{});else item.pendingCandidates.push(data.candidate);}
  }catch(e){console.warn('Voice signal:',e);}
}
async function voiceConnect(roomId,pin=''){
  await ensureVoiceConfig();const tk=await api('/api/voice/token',{method:'POST',body:'{}'});
  const proto=location.protocol==='https:'?'wss':'ws',ws=new WebSocket(`${proto}://${location.host}/voice-signal?token=${encodeURIComponent(tk.token)}`);ws.binaryType='arraybuffer';voiceState.ws=ws;voiceState.roomId=roomId;voiceState.roomPin=pin;voiceState.manualLeave=false;voiceStatus('Đang kết nối...');renderVoiceRoomState();
  ws.onmessage=async event=>{if(event.data instanceof ArrayBuffer||event.data instanceof Blob){await handleVoiceRelayPacket(event.data);return;}let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(msg.type==='ready'){voiceSend({type:'join',roomId:voiceState.roomId,pin:voiceState.roomPin});return;}
    if(msg.type==='joined'){voiceState.room=msg.room;voiceState.self=msg.self;voiceState.reconnectAttempts=0;voiceState.relayActive=false;await stopVoiceRelayCapture();voiceState.relayPlayHeads.clear();destroyVoicePeers();for(const peer of msg.peers||[])await createVoicePeer(peer,true);voiceStatus('🟢 Đã vào phòng','ok');renderVoiceRoomState();updateVoiceConnectionHint();await loadVoiceRooms();return;}
    if(msg.type==='peer-joined'){await createVoicePeer(msg.peer,false);renderVoiceParticipants();return;}
    if(msg.type==='peer-left'){const item=voiceState.peers.get(msg.connectionId);if(item){try{item.pc?.close?.();}catch{}item.audioEl?.remove();voiceState.peers.delete(msg.connectionId);}renderVoiceParticipants();return;}
    if(msg.type==='peer-state'){const item=voiceState.peers.get(msg.peer?.connectionId);if(item)item.meta={...item.meta,...msg.peer};renderVoiceParticipants();return;}
    if(msg.type==='signal'){await handleVoiceSignal(msg.from,msg.data||{});return;}
    if(msg.type==='room-closed'){alert('Phòng voice đã được đóng.');await leaveVoiceRoom(true);return;}
    if(msg.type==='error'){const message=msg.message||'Không thể vào phòng voice';voiceStatus('🔴 '+message);alert(message);await leaveVoiceRoom(true);return;}
  };
  ws.onclose=()=>{if(voiceState.ws!==ws)return;voiceState.ws=null;voiceState.relayActive=false;stopVoiceRelayCapture();voiceState.relayPlayHeads.clear();destroyVoicePeers();if(voiceState.roomId&&!voiceState.manualLeave&&isOnline()){voiceStatus('🟠 Mất kết nối • đang nối lại');scheduleVoiceReconnect();}else if(voiceState.roomId)voiceStatus('🟠 Mất kết nối');};
  ws.onerror=()=>voiceStatus('🟠 Kết nối voice không ổn định');
}
function scheduleVoiceReconnect(){if(voiceState.reconnectTimer||voiceState.manualLeave||!voiceState.roomId)return;const delay=Math.min(15000,1500*Math.pow(1.7,voiceState.reconnectAttempts++))+(document.hidden?3000:0);voiceState.reconnectTimer=setTimeout(async()=>{voiceState.reconnectTimer=null;if(!voiceState.roomId||voiceState.manualLeave||!isOnline())return;try{await voiceConnect(voiceState.roomId,voiceState.roomPin);}catch(e){console.warn('Voice reconnect',e);scheduleVoiceReconnect();}},delay);}
async function joinVoiceRoom(roomId,locked=false,providedPin=''){
  if(!requireOnline('Voice Chat'))return;ensureVoiceAudioContext();if(!window.RTCPeerConnection)return alert('Trình duyệt này không hỗ trợ WebRTC Voice.');let pin=providedPin||'';if(locked&&!pin){pin=prompt('Nhập mã phòng voice:','')||'';if(!pin)return;}
  if(voiceState.roomId&&voiceState.roomId!==roomId)await leaveVoiceRoom(true);
  try{await ensureVoiceMicrophone();voiceState.roomId=roomId;voiceState.roomPin=pin;await voiceConnect(roomId,pin);}catch(e){await leaveVoiceRoom(true);alert('Không thể mở voice: '+e.message);}
}
function toggleVoiceMute(){if(!voiceState.roomId)return;voiceState.muted=!voiceState.muted;voiceState.localStream?.getAudioTracks().forEach(t=>t.enabled=!voiceState.muted);voiceSend({type:'state',muted:voiceState.muted,deafened:voiceState.deafened});renderVoiceRoomState();}
function toggleVoiceDeafen(){if(!voiceState.roomId)return;voiceState.deafened=!voiceState.deafened;for(const item of voiceState.peers.values())if(item.audioEl)item.audioEl.muted=voiceState.deafened;if(!voiceState.deafened)unlockVoiceAudio();else setVoiceAudioBlocked(false,'🔕 Đã tắt âm thanh phòng');voiceSend({type:'state',muted:voiceState.muted,deafened:voiceState.deafened});renderVoiceRoomState();updateVoiceConnectionHint();}
async function leaveVoiceRoom(silent=false){
  voiceState.manualLeave=true;if(voiceState.reconnectTimer)clearTimeout(voiceState.reconnectTimer);voiceState.reconnectTimer=null;voiceState.relayActive=false;await stopVoiceRelayCapture();voiceState.relayPlayHeads.clear();try{voiceSend({type:'leave'});}catch{}try{voiceState.ws?.close(1000,'leave');}catch{}voiceState.ws=null;destroyVoicePeers();voiceState.localStream?.getTracks().forEach(t=>t.stop());voiceState.localStream=null;voiceState.roomId='';voiceState.roomPin='';voiceState.room=null;voiceState.self=null;voiceState.muted=false;voiceState.deafened=false;voiceState.reconnectAttempts=0;voiceState.audioBlocked=false;voiceStatus('Chưa kết nối');renderVoiceRoomState();if(activeRoute==='voice'&&isOnline())loadVoiceRooms();if(!silent)updatePerformanceUi();
}
function voiceResumeAfterVisibility(){if(!document.hidden&&voiceState.roomId&&!voiceState.ws&&isOnline()&&!voiceState.manualLeave){scheduleVoiceReconnect();}for(const item of voiceState.peers.values())if(item.audioEl&&!voiceState.deafened)item.audioEl.play().catch(()=>{});}



// ===== v1.8 Professional System =====
const PERMISSION_LABELS={manageMembers:'Quản lý thành viên / Timeout / Ban',manageAchievements:'Thành tích & Achievement Composer',manageReports:'Moderation Workflow',manageBackups:'Backup & Restore',viewAnalytics:'Xem Analytics',manageEvents:'Quản lý sự kiện',viewAudit:'Xem Audit Log',managePermissions:'Quản lý Permission Matrix'};
let permissionState=null;
async function loadPermissions(){
  const box=$('#permissionMatrix'); if(!box||!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline())return;
  try{
    const j=await api('/api/admin/permissions'); permissionState=j.matrix;
    const roles=['Kì Cựu','Member'];
    box.innerHTML=`<div class="permission-head"><b>Quyền</b>${roles.map(r=>`<b>${esc(r)}</b>`).join('')}</div>${j.keys.map(key=>`<div class="permission-row"><span>${esc(PERMISSION_LABELS[key]||key)}</span>${roles.map(role=>`<label><input type="checkbox" data-permission-role="${esc(role)}" data-permission-key="${esc(key)}" ${j.matrix?.[role]?.[key]?'checked':''} ${me.role!=='Boss'?'disabled':''}> ${j.matrix?.[role]?.[key]?'Bật':'Tắt'}</label>`).join('')}</div>`).join('')}`;
    if($('#savePermissionBtn'))$('#savePermissionBtn').hidden=me.role!=='Boss';
  }catch(e){box.innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
async function savePermissions(){
  if(me?.role!=='Boss')return alert('Chỉ Boss được thay đổi Permission Matrix.');
  const matrix={}; $$('[data-permission-role]').forEach(el=>{const r=el.dataset.permissionRole,k=el.dataset.permissionKey;matrix[r]=matrix[r]||{};matrix[r][k]=!!el.checked;});
  try{const j=await api('/api/admin/permissions',{method:'POST',body:JSON.stringify({matrix})});permissionState=j.matrix;alert('Đã lưu Permission Matrix.');await loadPermissions();await loadAudit();}catch(e){alert(e.message)}
}

async function loadAudit(){
  const box=$('#auditLog'); if(!box||!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline())return;
  try{
    const q=$('#auditSearch')?.value||'',category=$('#auditCategory')?.value||''; const j=await api(`/api/admin/audit?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&limit=200`);
    box.innerHTML=(j.logs||[]).map(l=>`<article class="audit-item"><div><span class="audit-category">${esc(l.category||'system')}</span><b>${esc(l.action)}</b><p>${esc(l.by||l.user||'Hệ thống')}${l.target?` → ${esc(l.target)}`:''}</p></div><small>${fmtDate(l.at)}</small></article>`).join('')||'<p class="muted">Không có dữ liệu Audit phù hợp.</p>';
  }catch(e){box.innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}

async function loadNotificationPreferences(){
  if(!me||!isOnline())return;
  try{const j=await api('/api/notification-preferences'),p=j.preferences||{}; const map={prefPushEnabled:'pushEnabled',prefDm:'dm',prefMentions:'mentions',prefFriends:'friends',prefAchievements:'achievements',prefModeration:'moderation',prefEvents:'events',prefSystem:'system',prefQuietEnabled:'quietEnabled'};for(const [id,key] of Object.entries(map))if($('#'+id))$('#'+id).checked=!!p[key];if($('#prefQuietStart'))$('#prefQuietStart').value=p.quietStart||'22:00';if($('#prefQuietEnd'))$('#prefQuietEnd').value=p.quietEnd||'07:00';}catch(e){console.warn('notification prefs',e.message)}
}
async function saveNotificationPreferences(){
  if(!requireOnline('Lưu tùy chọn thông báo'))return;
  const payload={pushEnabled:!!$('#prefPushEnabled')?.checked,dm:!!$('#prefDm')?.checked,mentions:!!$('#prefMentions')?.checked,friends:!!$('#prefFriends')?.checked,achievements:!!$('#prefAchievements')?.checked,moderation:!!$('#prefModeration')?.checked,events:!!$('#prefEvents')?.checked,system:!!$('#prefSystem')?.checked,quietEnabled:!!$('#prefQuietEnabled')?.checked,quietStart:$('#prefQuietStart')?.value||'22:00',quietEnd:$('#prefQuietEnd')?.value||'07:00',timezoneOffsetMinutes:-new Date().getTimezoneOffset()};
  try{const j=await api('/api/notification-preferences',{method:'POST',body:JSON.stringify(payload)});if(me)me.notificationPrefs=j.preferences;alert('Đã lưu tùy chọn thông báo.');}catch(e){alert(e.message)}
}

async function loadAccountCenter(){
  const box=$('#accountSummary'); if(!box||!me)return;
  if(!isOnline()){box.innerHTML='<p class="offline-note">Account Center cần mạng để kiểm tra trạng thái bảo mật mới nhất.</p>';return;}
  try{const j=await api('/api/account/summary');const u=j.user,s=j.security||{},perms=Object.entries(j.permissions||{}).filter(([,v])=>v).length;box.innerHTML=`<div class="account-stat"><b>${esc(u.displayName)}</b><span>@${esc(u.username)} • ${esc(u.role)}</span></div><div class="account-stat"><b>${s.twoFactorEnabled?'🟢 2FA bật':'🟠 2FA tắt'}</b><span>${s.recoveryCodesRemaining||0} Recovery Codes còn lại</span></div><div class="account-stat"><b>${s.sessions||0} thiết bị</b><span>Phiên đăng nhập hiện có</span></div><div class="account-stat"><b>${perms} quyền</b><span>Permission Matrix hiện tại</span></div>`;}catch(e){box.innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
function exportAccountData(){if(!requireOnline('Xuất dữ liệu cá nhân'))return;window.location.href='/api/account/export';}

function formatBytes(bytes){const n=Number(bytes)||0;if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`;}
async function loadSystemStatus(){
  const box=$('#systemStatusGrid'); if(!box||!me)return;
  if(!isOnline()){box.innerHTML='<div class="status-tile warn"><b>🟠 Offline</b><span>Không thể kiểm tra backend lúc này.</span></div>';refreshCacheManager();return;}
  try{const j=await api('/api/system/status');box.innerHTML=`<div class="status-tile ok"><b>🟢 Backend</b><span>v${esc(j.app?.version||'?')} • uptime ${Math.floor((j.app?.uptimeSeconds||0)/60)} phút</span></div><div class="status-tile ${j.database?.ok?'ok':'bad'}"><b>${j.database?.ok?'🟢':'🔴'} Database</b><span>${j.database?.users||0} users • ${j.database?.logs||0} logs</span></div><div class="status-tile ${j.storage?.ok?'ok':'bad'}"><b>${j.storage?.ok?'🟢':'🔴'} Storage</b><span>${formatBytes(j.storage?.bytes)} • ${esc(j.storage?.root||'')}</span></div><div class="status-tile ${j.push?.ok?'ok':'bad'}"><b>${j.push?.ok?'🟢':'🔴'} Push</b><span>${j.push?.subscriptions||0} subscriptions</span></div><div class="status-tile ok"><b>💾 Backup</b><span>${j.backup?.count||0} bản • ${j.backup?.lastAt?fmtDate(j.backup.lastAt):'chưa có'}</span></div><div class="status-tile ok"><b>🎙️ Voice</b><span>${j.voice?.rooms||0} phòng • ${j.voice?.participants||0} người${j.voice?.turnConfigured?' • TURN ✓':(j.voice?.relayFallback?' • STUN + Relay dự phòng':' • STUN')}</span></div><div class="status-tile ok"><b>🧹 Tự dọn</b><span>${j.cleanup?.lastAt?fmtDate(j.cleanup.lastAt):'chưa chạy'}</span></div>`;$('#statusUpdatedAt').textContent=`Cập nhật: ${fmtDate(j.app?.serverTime||new Date().toISOString())}`;if($('#appVersionBadge'))$('#appVersionBadge').textContent=`v${j.app?.version||'1.9.2'}`;
    const alerts=j.alerts||[];if($('#systemAlertCount'))$('#systemAlertCount').textContent=`${alerts.length} cảnh báo`;if($('#systemAlerts'))$('#systemAlerts').innerHTML=alerts.length?alerts.map(a=>`<article class="system-alert ${esc(a.level||'info')}"><b>${a.level==='danger'?'🔴':a.level==='warning'?'🟠':'🔵'} ${esc(a.title)}</b><span>${esc(a.detail||'')}</span></article>`).join(''):'<div class="system-alert ok"><b>🟢 Hệ thống ổn định</b><span>Không phát hiện cảnh báo vận hành.</span></div>';updatePerformanceUi();
  }catch(e){box.innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}
}
async function refreshCacheManager(){const box=$('#cacheManagerInfo');if(!box)return;try{const info=await window.getAppCacheInfo?.()||{};box.innerHTML=`<div><b>Service Worker</b><span>${info.controlled?'🟢 Đang kiểm soát':'🟠 Chưa kiểm soát'}</span></div><div><b>Phiên bản client</b><span>${esc(info.version||'1.9.2')}</span></div><div><b>Update chờ</b><span>${info.waiting?'Có bản mới sẵn sàng':'Không'}</span></div><div><b>Cache</b><span>${(info.cacheKeys||[]).map(esc).join(', ')||'Chưa có'}</span></div>`;}catch(e){box.innerHTML=`<p class="muted">${esc(e.message)}</p>`;}}
async function checkAppUpdate(){try{const j=await window.checkForAppUpdate?.();await refreshCacheManager();alert(j?.waiting?'Có bản cập nhật mới. Bấm “Cập nhật ngay”.':'Bạn đang dùng bản mới nhất đã phát hiện.');}catch(e){alert(e.message||'Không kiểm tra được cập nhật.')}}
async function updateAppNow(){try{await window.forceAppUpdate?.();}catch(e){alert(e.message||'Không thể cập nhật.')}}
async function clearAppCache(){if(!confirm('Xóa cache ứng dụng và tải lại? Offline Queue không bị xóa.'))return;try{await window.clearAppCaches?.();location.reload();}catch(e){alert(e.message||'Không thể xóa cache.')}}


async function loadSystemSettings(){
  const card=$('#systemSettingsCard');if(!card||me?.role!=='Boss')return;if(!isOnline()){card.querySelector('.muted').textContent='Cần mạng để tải cài đặt hệ thống.';return;}
  try{const j=await api('/api/admin/system-settings'),v=j.settings||{};$('#settingRegistration').checked=!!v.registrationEnabled;$('#settingChatCooldown').value=v.chatCooldownMs||1200;$('#settingVoiceMax').value=v.voiceMaxParticipants||6;$('#settingVoiceRooms').value=v.voiceMaxRooms||20;$('#settingCleanupHours').value=v.cleanupIntervalHours||6;$('#settingLogDays').value=v.logRetentionDays||30;$('#settingOrphanDays').value=v.uploadOrphanDays||7;$('#settingStorageMb').value=v.storageWarningMb||512;if($('#cleanupResult'))$('#cleanupResult').textContent=j.meta?.lastCleanupAt?`Lần dọn gần nhất: ${fmtDate(j.meta.lastCleanupAt)}`:'Chưa có lần tự dọn nào.';}catch(e){alert(e.message)}
}
async function saveSystemSettings(){
  if(me?.role!=='Boss')return alert('Chỉ Boss được thay đổi cài đặt hệ thống.');if(!requireOnline('Lưu cài đặt hệ thống'))return;
  const body={registrationEnabled:!!$('#settingRegistration').checked,chatCooldownMs:Number($('#settingChatCooldown').value),voiceMaxParticipants:Number($('#settingVoiceMax').value),voiceMaxRooms:Number($('#settingVoiceRooms').value),cleanupIntervalHours:Number($('#settingCleanupHours').value),logRetentionDays:Number($('#settingLogDays').value),uploadOrphanDays:Number($('#settingOrphanDays').value),storageWarningMb:Number($('#settingStorageMb').value)};
  try{await api('/api/admin/system-settings',{method:'POST',body:JSON.stringify(body)});alert('Đã lưu cài đặt hệ thống.');await Promise.allSettled([loadSystemSettings(),loadSystemStatus(),loadAudit()]);}catch(e){alert(e.message)}
}
async function runSystemCleanup(){
  if(me?.role!=='Boss')return;if(!requireOnline('Dọn dữ liệu rác'))return;if(!confirm('Chạy dọn session hết hạn, log cũ và upload không còn được sử dụng?'))return;
  try{const j=await api('/api/admin/system-cleanup',{method:'POST',body:'{}'}),x=j.stats||{};$('#cleanupResult').textContent=`✅ Đã dọn: ${x.logs||0} log, ${x.notifications||0} thông báo cũ, ${x.teamPosts||0} bài cũ, ${x.sessions||0} session, ${x.uploads||0} file rác.`;await Promise.allSettled([loadSystemStatus(),loadAudit()]);}catch(e){alert(e.message)}
}

function updatePerformanceUi(){
  const hidden=document.hidden;document.body.classList.toggle('background-lite',hidden);const p=$('#performanceState');if(p){p.textContent=hidden?(voiceState.roomId?'🎙️ Voice nền':'🌙 Nền nhẹ'):'⚡ Hoạt động';p.className=`network-pill ${hidden?'offline':'online'}`;}
  const b=$('#backgroundModeBadge');if(b)b.textContent=hidden?'🌙 Đang tiết kiệm tài nguyên':'⚡ Đang hoạt động';
}
function stopAdaptiveTimers(){if(clockTimer)clearTimeout(clockTimer);if(heartbeatTimer)clearTimeout(heartbeatTimer);if(notificationTimer)clearTimeout(notificationTimer);clockTimer=heartbeatTimer=notificationTimer=null;}
function startAdaptiveTimers(){
  stopAdaptiveTimers();
  const clockTick=()=>{if($('#clock'))$('#clock').textContent=new Date().toLocaleString('vi-VN');clockTimer=setTimeout(clockTick,document.hidden?60000:1000);};
  const heartbeatTick=async()=>{try{if(me&&isOnline()&&(!document.hidden||voiceState.roomId)){await fetch('/api/ping',{method:'POST',credentials:'same-origin'});if(!document.hidden)await members();}}catch{}heartbeatTimer=setTimeout(heartbeatTick,document.hidden?(voiceState.roomId?120000:300000):60000);};
  const noteTick=async()=>{try{if(me&&isOnline()&&!document.hidden)await loadNotifications();}catch{}notificationTimer=setTimeout(noteTick,document.hidden?300000:30000);};
  clockTick();heartbeatTimer=setTimeout(heartbeatTick,60000);notificationTimer=setTimeout(noteTick,30000);updatePerformanceUi();
}


// v1.9 dùng timer thích ứng thay cho polling cố định để giảm CPU/RAM khi ứng dụng ở nền.

window.addEventListener('online', async () => { await updateOfflineStatus(); if(activeRoute==='chat')startChatTimer(); if(activeRoute==='voice')loadVoiceRooms(); if(voiceState.roomId&&!voiceState.ws&&!voiceState.manualLeave)scheduleVoiceReconnect(); if ('SyncManager' in window) window.requestBackgroundSync?.(); else await syncOfflineQueue(false); startAdaptiveTimers(); });
window.addEventListener('offline', async () => { stopChatTimer(); stopVoiceRoomRefresh(); await updateOfflineStatus(); voiceStatus(voiceState.roomId?'🟠 Mất mạng • chờ nối lại':'Chưa kết nối'); if (me) { members(); music(); loadChat(); loadFriends(); } startAdaptiveTimers(); });
document.addEventListener('visibilitychange', async () => {
  updatePerformanceUi();startAdaptiveTimers();
  if(document.hidden){stopChatTimer();stopVoiceRoomRefresh();}
  else{if(activeRoute==='chat')startChatTimer();if(activeRoute==='voice')startVoiceRoomRefresh();voiceResumeAfterVisibility();if(me&&isOnline())await Promise.allSettled([members(),loadNotifications()]);}
});
window.addEventListener('error', event => console.error('UI error:', event.error || event.message));
window.addEventListener('unhandledrejection', event => console.error('Promise error:', event.reason));
setupInteractions();
if (location.protocol === 'file:') msg('⚠️ Không mở index.html trực tiếp. Hãy chạy npm install → npm start rồi mở http://localhost:3000');
window.addEventListener('load', () => { drawRoleAvatar(); drawBanner(); updateOfflineStatus(); startAdaptiveTimers(); updatePerformanceUi(); setTimeout(()=>drawProfileCard().catch?.(()=>{}),200); });
navigator.mediaDevices?.addEventListener?.('devicechange',()=>{if(voiceState.localStream)populateVoiceMicrophones();});
show();
