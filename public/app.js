const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CACHEABLE_GETS = new Set(['/api/me', '/api/members', '/api/music', '/api/friends', '/api/events']);
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
function avatarHTML(u, size = 'small') { const m = meta(u.role); return `<div class="role-avatar ${m.key} ${size}"><img src="${esc(avatarOf(u))}" alt="Avatar ${esc(u.displayName)}"><span class="role-crown">${m.icon}</span></div>`; }
function isOnline() { return navigator.onLine !== false; }
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
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  await window.OfflineDB?.clearAll?.();
  location.reload();
}

function routeTo(route) {
  const allowed = ['overview','profile','chat','team','match','events','profile-card','notifications','friends','sync-center','avatar-tool','qr','pdf','tournament','banner','image-tool','music','security','admin'];
  if (!allowed.includes(route)) route = 'overview';
  if (route === 'admin' && !['Boss','Kì Cựu'].includes(me?.role)) route = 'overview';
  $$('.page-section').forEach(s => s.hidden = s.dataset.section !== route);
  $$('.hub-nav [data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  history.replaceState(null, '', '#' + route);
  if (route === 'chat') { loadChat(); startChatTimer(); } else stopChatTimer();
  if (route === 'team') loadTeamPosts();
  if (route === 'match') { if ($('#matchGame') && $('#teamGame')) $('#matchGame').value=$('#teamGame').value; }
  if (route === 'events') loadEvents();
  if (route === 'profile-card') drawProfileCard();
  if (route === 'notifications') { loadNotifications(); refreshPushStatus(); }
  if (route === 'friends') loadFriends();
  if (route === 'sync-center') renderSyncCenter();
  if (route === 'security') { loadSessions(); loadTwoFactorStatus(); }
  if (route === 'avatar-tool') drawRoleAvatar();
  if (route === 'banner') drawBanner();
  if (route === 'admin' && isOnline()) { loadAdminReports(); loadBackups(); loadAnalytics(); }
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
    'setup-2fa': setupTwoFactor, 'confirm-2fa': confirmTwoFactor, 'disable-2fa': disableTwoFactor, 'load-analytics': loadAnalytics
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
  if (action === 'restore-backup') return restoreBackup(el.dataset.file);
  if (action === 'delete-backup') return deleteBackup(el.dataset.file);
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
  $('#profileAvatarWrap').className = `role-avatar ${m.key} hero`; $('#avatar').src = avatarOf(me);
  $('#name').textContent = me.displayName; $('#role').className = `role role-${m.key}`; $('#role').textContent = `${m.icon} ${m.label}`;
  $('#profilePageAvatarWrap').className = `role-avatar ${m.key} hero`; $('#profilePageAvatar').src = avatarOf(me);
  $('#profilePageName').textContent = me.displayName; $('#profilePageRole').className = `role role-${m.key}`; $('#profilePageRole').textContent = `${m.icon} ${m.label}`;
  $('#profileJoinDate').textContent = `Tham gia: ${fmtDate(me.createdAt)}`;
  $('#newName').value = me.displayName || ''; $('#bio').value = me.bio || ''; $('#games').value = me.games || ''; $('#gameId').value = me.gameId || ''; $('#discord').value = me.discord || '';
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
}
async function show() {
  if (!me) {
    try { me = (await api('/api/me')).user; }
    catch { if (!isOnline()) msg('🟠 Offline: cần đăng nhập online ít nhất một lần trên thiết bị này trước.'); return; }
  }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#adminNav').hidden = !['Boss','Kì Cựu'].includes(me.role);
  if($('#eventAdminCard')) $('#eventAdminCard').hidden=!['Boss','Kì Cựu'].includes(me.role);
  renderProfile();
  await Promise.allSettled([members(), music(), adminUsers(), loadTeamPosts(), loadNotifications(), loadFriends()]);
  setupRoutes(); routeTo(location.hash.slice(1) || 'overview');
  await updateOfflineStatus();
  if (isOnline()) { if ('SyncManager' in window) window.requestBackgroundSync?.(); else syncOfflineQueue(false); }
}

async function saveProfile() {
  const payload = { displayName: $('#newName').value, bio: $('#bio').value, games: $('#games').value, gameId: $('#gameId').value, discord: $('#discord').value, baseUpdatedAt: me?.profileUpdatedAt || '' };
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
function startChatTimer() { stopChatTimer(); if (isOnline()) chatTimer = setInterval(loadChat, 3500); }
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


async function findTeamMatch(){if(!requireOnline('Ghép đồng đội tự động'))return;try{const j=await api('/api/team-match',{method:'POST',body:JSON.stringify({game:$('#matchGame').value,mode:$('#matchMode').value,server:$('#matchServer').value,playTime:$('#matchTime').value})});const a=j.matches||[];$('#matchCount').textContent=`${a.length} kết quả`;$('#matchResults').innerHTML=a.map(p=>`<article class="team-post"><div class="match-score">${p.score}%</div>${avatarHTML(p)}<div class="team-main"><b>${esc(p.displayName)}</b><h3>${esc(p.game)} ${p.mode?`• ${esc(p.mode)}`:''}</h3><p>${esc((p.reasons||[]).join(' • '))}</p><p>${p.server?`🌐 ${esc(p.server)} • `:''}${p.playTime?`🕒 ${esc(p.playTime)} • `:''}👥 Cần ${p.slots}</p><p>${esc(p.note||'')}</p></div></article>`).join('')||'<p class="muted">Chưa tìm thấy bài phù hợp. Thử nới tiêu chí.</p>';}catch(e){alert(e.message)}}
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
async function loadAnalytics(){if(!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline()||!$('#analyticsGrid'))return;try{const j=await api('/api/admin/analytics');const rows=[['👥 Thành viên',j.users],['🟢 Online',j.online5m],['💬 Chat 24h',j.chat24h],['🤝 Bài tìm đội',j.teamOpen],['📅 Sự kiện',j.events],['🚩 Báo cáo mở',j.reportsOpen],['💾 Backup',j.backups],['🗂️ Storage',(j.storageBytes/1024/1024).toFixed(1)+' MB']];$('#analyticsGrid').innerHTML=rows.map(([k,v])=>`<div class="metric"><b>${k}</b><strong>${esc(v)}</strong></div>`).join('');$('#analyticsTopXp').innerHTML=`<h4>🏆 Top XP</h4>${(j.topXp||[]).map((u,i)=>`<div class="top-xp"><span>#${i+1} ${esc(u.displayName)}</span><b>Lv.${u.level} • ${u.xp} XP</b></div>`).join('')}`;}catch(e){$('#analyticsGrid').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}

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
async function loadAdminReports(){if(!me||!['Boss','Kì Cựu'].includes(me.role)||!isOnline())return;try{const j=await api('/api/admin/reports');$('#adminReports').innerHTML=(j.reports||[]).map(r=>`<article class="report-row ${r.status}"><div><b>🚩 ${esc(r.targetType)} • ${esc(r.status)}</b><p>${esc(r.reason)}</p><small>@${esc(r.reporterUsername||'')} • ${fmtDate(r.createdAt)}${r.resolvedBy?` • xử lý bởi ${esc(r.resolvedBy)}`:''}</small></div>${r.status==='open'?`<div class="report-actions"><button class="tiny" data-action="resolve-report" data-id="${r.id}" data-status="resolved">Đã xử lý</button><button class="tiny ghost" data-action="resolve-report" data-id="${r.id}" data-status="dismissed">Bỏ qua</button></div>`:''}</article>`).join('')||'<p class="muted">Không có báo cáo.</p>';}catch(e){$('#adminReports').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;}}
async function resolveReport(id,status){if(!requireOnline('Xử lý báo cáo'))return;try{await api(`/api/admin/reports/${id}/resolve`,{method:'POST',body:JSON.stringify({status})});await loadAdminReports();}catch(e){alert(e.message)}}
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

setInterval(() => { if ($('#clock')) $('#clock').textContent = new Date().toLocaleString('vi-VN'); }, 1000);
setInterval(() => { if (me && isOnline()) fetch('/api/ping', { method: 'POST', credentials: 'same-origin' }).then(() => members()).catch(()=>{}); }, 60000);

setInterval(() => { if (me && isOnline()) loadNotifications(); }, 30000);

window.addEventListener('online', async () => { await updateOfflineStatus(); startChatTimer(); if ('SyncManager' in window) window.requestBackgroundSync?.(); else await syncOfflineQueue(false); });
window.addEventListener('offline', async () => { stopChatTimer(); await updateOfflineStatus(); if (me) { members(); music(); loadChat(); loadFriends(); } });
window.addEventListener('error', event => console.error('UI error:', event.error || event.message));
window.addEventListener('unhandledrejection', event => console.error('Promise error:', event.reason));
setupInteractions();
if (location.protocol === 'file:') msg('⚠️ Không mở index.html trực tiếp. Hãy chạy npm install → npm start rồi mở http://localhost:3000');
window.addEventListener('load', () => { drawRoleAvatar(); drawBanner(); updateOfflineStatus(); setTimeout(()=>drawProfileCard().catch?.(()=>{}),200); });
show();
