const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CACHEABLE_GETS = new Set(['/api/me', '/api/members', '/api/music']);
const isCacheableGet = url => CACHEABLE_GETS.has(url) || url.startsWith('/api/chat') || url.startsWith('/api/team-posts') || url.startsWith('/api/notifications');
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
function httpError(message, status) { const e = new Error(message); e.httpStatus = status; e.isHttp = true; return e; }

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
    if (!r.ok) throw httpError(j.error || 'Có lỗi xảy ra', r.status);
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
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          await window.OfflineDB.deleteQueue(item.id);
          done++;
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
    await Promise.allSettled([members(), music(), loadChat(), loadTeamPosts(), loadNotifications()]);
  }
  if (showResult) alert(done ? `Đã đồng bộ ${done} thao tác.` : 'Chưa đồng bộ được dữ liệu.');
}
window.syncOfflineQueue = syncOfflineQueue;

window.refreshAfterBackgroundSync = async () => {
  if (!me || !isOnline()) return;
  try { me = (await api('/api/me')).user; renderProfile(); } catch {}
  await Promise.allSettled([members(), music(), loadChat(), loadTeamPosts(), loadNotifications(), adminUsers()]);
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
  try {
    const j = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#user').value, password: $('#pass').value }) });
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
  const allowed = ['overview','profile','chat','team','notifications','avatar-tool','qr','pdf','tournament','banner','image-tool','music','security','admin'];
  if (!allowed.includes(route)) route = 'overview';
  if (route === 'admin' && !['Boss','Kì Cựu'].includes(me?.role)) route = 'overview';
  $$('.page-section').forEach(s => s.hidden = s.dataset.section !== route);
  $$('.hub-nav [data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  history.replaceState(null, '', '#' + route);
  if (route === 'chat') { loadChat(); startChatTimer(); } else stopChatTimer();
  if (route === 'team') loadTeamPosts();
  if (route === 'notifications') loadNotifications();
  if (route === 'security') loadSessions();
  if (route === 'avatar-tool') drawRoleAvatar();
  if (route === 'banner') drawBanner();
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
    'clear-offline': clearOfflineData, 'change-chat-room': changeChatRoom, 'create-team-post': createTeamPost, 'load-team-posts': loadTeamPosts, 'read-all-notifications': readAllNotifications, 'load-sessions': loadSessions, 'change-password': changePassword
  };
  if (action === 'download-canvas') return downloadCanvas(el.dataset.canvas, el.dataset.filename || 'download.png');
  if (action === 'rotate-image') return rotateImage(Number(el.dataset.deg) || 0);
  if (action === 'delete-chat') return deleteChat(el.dataset.id);
  if (action === 'add-achievement') return addAchievement(el.dataset.id);
  if (action === 'ban-user') return ban(el.dataset.id, el.dataset.banned === 'true');
  if (action === 'set-role') return setRole(el.dataset.id, el.value);
  if (action === 'reply-chat') return setChatReply(el.dataset.id);
  if (action === 'cancel-chat-reply') return setChatReply('');
  if (action === 'react-chat') return reactChat(el.dataset.id, el.dataset.emoji);
  if (action === 'close-team-post') return closeTeamPost(el.dataset.id);
  if (action === 'delete-team-post') return deleteTeamPost(el.dataset.id);
  if (action === 'open-notification') return openNotification(el.dataset.id, el.dataset.route, el.dataset.room);
  if (action === 'revoke-session') return revokeSession(el.dataset.id);
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
}
function renderAchievements(items) {
  $('#achievementCount').textContent = `${items.length} thành tích`;
  $('#achievementList').innerHTML = items.length ? items.map(a => `<article class="achievement"><div class="achievement-icon">${esc(a.icon || '🏆')}</div><div><b>${esc(a.title)}</b><p>${esc(a.description || '')}</p><small>Trao bởi ${esc(a.awardedBy || 'Hệ thống')} • ${fmtDate(a.awardedAt)}</small></div></article>`).join('') : '<p class="muted">Chưa có thành tích được trao.</p>';
}
async function show() {
  if (!me) {
    try { me = (await api('/api/me')).user; }
    catch { if (!isOnline()) msg('🟠 Offline: cần đăng nhập online ít nhất một lần trên thiết bị này trước.'); return; }
  }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#adminNav').hidden = !['Boss','Kì Cựu'].includes(me.role);
  renderProfile();
  await Promise.allSettled([members(), music(), adminUsers(), loadTeamPosts(), loadNotifications()]);
  setupRoutes(); routeTo(location.hash.slice(1) || 'overview');
  await updateOfflineStatus();
  if (isOnline()) { if ('SyncManager' in window) window.requestBackgroundSync?.(); else syncOfflineQueue(false); }
}

async function saveProfile() {
  const payload = { displayName: $('#newName').value, bio: $('#bio').value, games: $('#games').value, gameId: $('#gameId').value, discord: $('#discord').value };
  try {
    const j = await api('/api/profile', { method: 'POST', body: JSON.stringify(payload), queueIfOffline: 'profile' });
    if (j.queued) {
      me = { ...me, ...payload, displayName: payload.displayName || me.displayName };
      await snapshotPut('/api/me', { user: me }); renderProfile();
      alert('Đã lưu hồ sơ trên thiết bị. Khi có mạng, hệ thống sẽ tự đồng bộ.'); return;
    }
    me = j.user; await snapshotPut('/api/me', { user: me }); renderProfile(); await members(); alert('Đã lưu hồ sơ.');
  } catch (e) { alert(e.message); }
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
    $('#memberList').innerHTML = a.map(u => { const m = meta(u.role); return `<div class="member role-card-${m.key}">${avatarHTML(u)}<span class="dot ${!j.__offline && u.online ? 'on' : ''}" title="${j.__offline ? 'Trạng thái đã lưu' : u.online ? 'Đang online' : 'Offline'}"></span><div class="member-info"><b>${esc(u.displayName)}</b><span class="mini-role ${m.key}">${m.icon} ${m.label}</span><small>${esc(u.games || '')}</small></div></div>`; }).join('');
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
    const j = await api('/api/chat?room=' + encodeURIComponent(selectedChatRoom));
    const queued = await window.OfflineDB?.listQueue?.() || [];
    const pending = queued.filter(x => x.type === 'chat' && (x.body?.room || 'general') === selectedChatRoom).map(x => ({ id: 'pending-' + x.id, clientId: x.body?.clientId, userId: me.id, username: me.username, displayName: me.displayName, role: me.role, avatar: me.avatar, room:selectedChatRoom, text: x.body?.text || '', replyTo:x.body?.replyTo || '', reactions:{}, createdAt: new Date(x.createdAt).toISOString(), mine: true, pending: true }));
    const all = [...(j.messages || []), ...pending];
    $('#chatMessages').innerHTML = all.map(m => { const reactions = Object.entries(m.reactions || {}).filter(([,ids]) => ids.length).map(([emoji,ids]) => `<button class="reaction ${ids.includes(me.id)?'mine':''}" data-action="react-chat" data-id="${m.id}" data-emoji="${emoji}" ${m.pending?'disabled':''}>${emoji} ${ids.length}</button>`).join(''); return `<div class="chat-message ${m.mine ? 'mine' : ''} ${m.pending ? 'pending' : ''}">${avatarHTML(m)}<div class="chat-bubble">${m.replyPreview ? `<div class="reply-preview">↪ ${esc(m.replyPreview.displayName)}: ${esc(m.replyPreview.text)}</div>`:''}<div class="chat-head"><b>${esc(m.displayName)}</b><span class="mini-role ${meta(m.role).key}">${meta(m.role).icon} ${esc(m.role)}</span><small>${m.pending ? '⏳ chờ đồng bộ' : fmtDate(m.createdAt)}</small></div><p>${esc(m.text)}</p><div class="chat-actions">${!m.pending?`<button class="tiny ghost" data-action="reply-chat" data-id="${m.id}">↩ Trả lời</button>${['👍','❤️','😂','🔥','🎮'].map(e=>`<button class="tiny ghost" data-action="react-chat" data-id="${m.id}" data-emoji="${e}">${e}</button>`).join('')}`:''}${(m.mine || ['Boss','Kì Cựu'].includes(me.role)) && !m.pending ? `<button class="tiny danger" data-action="delete-chat" data-id="${m.id}">Xóa</button>` : ''}</div><div class="reactions">${reactions}</div></div></div>`; }).join('') || '<p class="muted">Chưa có tin nhắn.</p>';
    const box=$('#chatMessages'); box.scrollTop=box.scrollHeight;
  } catch (e) { $('#chatMessages').innerHTML = `<p class="offline-note">${esc(e.message)}</p>`; }
}
async function sendChat() {
  const input=$('#chatInput'); const text=input.value.trim(); if(!text)return;
  const body={ text, clientId:uid(), room:selectedChatRoom, replyTo:replyingTo?.id || '' };
  try { const j=await api('/api/chat',{method:'POST',body:JSON.stringify(body),queueIfOffline:'chat'}); input.value=''; setChatReply(''); await loadChat(); if(j.queued) await updateOfflineStatus(); } catch(e){ alert(e.message); }
}
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

async function loadTeamPosts() { if(!me)return; try { const j=await api('/api/team-posts'); const queued=await window.OfflineDB?.listQueue?.()||[]; const pending=queued.filter(x=>x.type==='team').map(x=>({id:'pending-'+x.id,userId:me.id,username:me.username,displayName:me.displayName,role:me.role,avatar:me.avatar,game:x.body?.game||'',mode:x.body?.mode||'',server:x.body?.server||'',playTime:x.body?.playTime||'',slots:x.body?.slots||1,note:x.body?.note||'',status:'pending',createdAt:new Date(x.createdAt).toISOString(),expiresAt:new Date(x.createdAt+(Number(x.body?.expireHours)||24)*3600000).toISOString(),mine:true,pending:true})); const posts=[...(j.posts||[]),...pending]; $('#teamPosts').innerHTML=posts.map(p=>`<article class="team-post ${p.status}">${avatarHTML(p)}<div class="team-main"><div class="team-head"><b>${esc(p.displayName)}</b><span class="mini-role ${meta(p.role).key}">${esc(p.role)}</span><span class="status-pill">${p.status==='pending'?'⏳ Chờ đồng bộ':p.status==='open'?'🟢 Đang tìm':p.status==='expired'?'⌛ Hết hạn':'✅ Đã đủ'}</span></div><h3>${esc(p.game)} ${p.mode?`• ${esc(p.mode)}`:''}</h3><p>${p.server?`🌐 ${esc(p.server)} • `:''}${p.playTime?`🕒 ${esc(p.playTime)} • `:''}👥 Cần ${p.slots}</p><p>${esc(p.note||'')}</p><small>Đăng ${fmtDate(p.createdAt)} • hết hạn ${fmtDate(p.expiresAt)}</small>${!p.pending&&(p.mine||['Boss','Kì Cựu'].includes(me.role))?`<div class="team-actions"><button class="tiny ghost" data-action="close-team-post" data-id="${p.id}">${p.status==='open'?'Đã đủ người':'Mở lại'}</button><button class="tiny danger" data-action="delete-team-post" data-id="${p.id}">Xóa</button></div>`:''}</div></article>`).join('')||'<p class="muted">Chưa có bài tìm đồng đội.</p>'; } catch(e){ $('#teamPosts').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`; } }
async function createTeamPost(){ const body={clientId:uid(),game:$('#teamGame').value,mode:$('#teamMode').value,server:$('#teamServer').value,playTime:$('#teamTime').value,slots:Number($('#teamSlots').value)||1,expireHours:Number($('#teamExpire').value)||24,note:$('#teamNote').value}; try{const j=await api('/api/team-posts',{method:'POST',body:JSON.stringify(body),queueIfOffline:'team'}); $('#teamNote').value=''; await loadTeamPosts(); if(j.queued) alert('Đã lưu bài vào hàng đợi. Khi có mạng sẽ tự đăng.');}catch(e){alert(e.message);} }
async function closeTeamPost(id){if(!requireOnline('Đổi trạng thái bài tìm đồng đội'))return;try{await api(`/api/team-posts/${id}/close`,{method:'POST'});loadTeamPosts();}catch(e){alert(e.message)}}
async function deleteTeamPost(id){if(!requireOnline('Xóa bài tìm đồng đội'))return;if(!confirm('Xóa bài này?'))return;try{await api(`/api/team-posts/${id}`,{method:'DELETE'});loadTeamPosts();}catch(e){alert(e.message)}}

async function loadNotifications(){ if(!me)return; try{const j=await api('/api/notifications'); const badge=$('#notificationBadge'); if(badge){badge.hidden=!j.unread;badge.textContent=j.unread||0;} $('#notificationList').innerHTML=(j.notifications||[]).map(n=>`<article class="notification-item ${n.read?'read':'unread'}" data-action="open-notification" data-id="${n.id}" data-route="${esc(n.route||'')}" data-room="${esc(n.room||'')}"><div class="notification-icon">${n.type==='achievement'?'🏆':n.type==='mention'?'@':n.type==='reply'?'↩️':n.type==='role'?'👑':'🔔'}</div><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${fmtDate(n.createdAt)}</small></div></article>`).join('')||'<p class="muted">Chưa có thông báo.</p>'; }catch(e){$('#notificationList').innerHTML=`<p class="offline-note">${esc(e.message)}</p>`;} }
async function readAllNotifications(){if(!requireOnline('Đánh dấu thông báo'))return;await api('/api/notifications/read',{method:'POST',body:'{}'});loadNotifications();}
async function openNotification(id,route,room){ if(isOnline()) await api('/api/notifications/read',{method:'POST',body:JSON.stringify({id})}).catch(()=>{}); if(room){selectedChatRoom=room;if($('#chatRoom'))$('#chatRoom').value=room;} if(route) routeTo(route); else loadNotifications(); }

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
  $('#users').innerHTML = a.length ? a.map(u => { const m = meta(u.role); return `<div class="user role-card-${m.key}">${avatarHTML(u)}<div class="member-info"><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small><span class="mini-role ${m.key}">${m.icon} ${m.label}${u.banned ? ' • ⛔ BANNED' : ''}</span><small>${(u.achievements || []).length} thành tích</small></div><div class="admin-actions">${me.role === 'Boss' ? `<select data-change-action="set-role" data-id="${esc(u.id)}" aria-label="Đổi role"><option value="${esc(u.role)}">${esc(u.role)}</option>${['Boss','Kì Cựu','Member'].filter(r => r !== u.role).map(r => `<option value="${r}">${r}</option>`).join('')}</select>` : ''}<button data-action="add-achievement" data-id="${esc(u.id)}">🏆 Thành tích</button><button class="${u.banned ? 'unban' : 'ban'}" data-action="ban-user" data-id="${esc(u.id)}" data-banned="${!u.banned}">${u.banned ? 'Mở cấm' : 'Cấm'}</button></div></div>`; }).join('') : '<p class="muted">Không tìm thấy thành viên phù hợp.</p>';
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
async function backup() { if (!requireOnline('Backup')) return; const j = await api('/api/backup', { method: 'POST' }); alert('Đã backup: ' + j.file); }

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
window.addEventListener('offline', async () => { stopChatTimer(); await updateOfflineStatus(); if (me) { members(); music(); loadChat(); } });
window.addEventListener('error', event => console.error('UI error:', event.error || event.message));
window.addEventListener('unhandledrejection', event => console.error('Promise error:', event.reason));
setupInteractions();
if (location.protocol === 'file:') msg('⚠️ Không mở index.html trực tiếp. Hãy chạy npm install → npm start rồi mở http://localhost:3000');
window.addEventListener('load', () => { drawRoleAvatar(); drawBanner(); updateOfflineStatus(); });
show();
