const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = async (url, opt = {}) => {
  const headers = { ...(opt.headers || {}) };
  if (!(opt.body instanceof FormData) && opt.body != null) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { ...opt, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || 'Có lỗi xảy ra');
  return j;
};
let me = null;
let adminCache = [];
let chatTimer = null;
let roleAvatarImg = null;
let bannerBgImg = null;
let imageToolImg = null;
let imageToolRotation = 0;
let qrBlobUrl = '';

const roleMeta = {
  'Boss': { key: 'boss', icon: '👑', label: 'BOSS', fallback: '/assets/avatar-boss.svg', c1: '#ffd86b', c2: '#ff7a00' },
  'Kì Cựu': { key: 'elder', icon: '🛡️', label: 'KÌ CỰU', fallback: '/assets/avatar-elder.svg', c1: '#77ddff', c2: '#7c5cff' },
  'Member': { key: 'member', icon: '👤', label: 'MEMBER', fallback: '/assets/avatar-member.svg', c1: '#7fffe3', c2: '#1fa6ff' }
};
const meta = role => roleMeta[role] || roleMeta.Member;
const avatarOf = u => u.avatar || meta(u.role).fallback;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmtDate = v => v ? new Date(v).toLocaleString('vi-VN') : '';
function msg(t) { $('#msg').textContent = t; }
function avatarHTML(u, size = 'small') { const m = meta(u.role); return `<div class="role-avatar ${m.key} ${size}"><img src="${esc(avatarOf(u))}" alt="Avatar ${esc(u.displayName)}"><span class="role-crown">${m.icon}</span></div>`; }

async function register() {
  try { const j = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('#user').value, password: $('#pass').value, displayName: $('#display').value }) }); me = j.user; show(); }
  catch (e) { msg(e.message); }
}
async function login() {
  try { const j = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#user').value, password: $('#pass').value }) }); me = j.user; show(); }
  catch (e) { msg(e.message); }
}
async function logout() { await fetch('/api/logout', { method: 'POST' }); location.reload(); }

function routeTo(route) {
  const allowed = ['overview','profile','chat','avatar-tool','qr','pdf','tournament','banner','image-tool','music','admin'];
  if (!allowed.includes(route)) route = 'overview';
  if (route === 'admin' && !['Boss','Kì Cựu'].includes(me?.role)) route = 'overview';
  $$('.page-section').forEach(s => s.hidden = s.dataset.section !== route);
  $$('.hub-nav [data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  history.replaceState(null, '', '#' + route);
  if (route === 'chat') { loadChat(); startChatTimer(); } else stopChatTimer();
  if (route === 'avatar-tool') drawRoleAvatar();
  if (route === 'banner') drawBanner();
}
let routesReady = false;
function setupRoutes() {
  if (routesReady) return;
  routesReady = true;
  window.addEventListener('hashchange', () => me && routeTo(location.hash.slice(1) || 'overview'));
}

function runUiAction(action, el) {
  const actions = {
    'login': login,
    'register': register,
    'logout': logout,
    'upload-avatar': uploadAvatar,
    'save-profile': saveProfile,
    'send-chat': sendChat,
    'generate-qr': generateQR,
    'download-qr': downloadQR,
    'merge-pdfs': mergePDFs,
    'images-to-pdf': imagesToPDF,
    'compress-pdf': compressPDF,
    'generate-tournament': generateTournament,
    'draw-banner': drawBanner,
    'render-image-tool': renderImageTool,
    'download-edited-image': downloadEditedImage,
    'add-music': addMusic,
    'backup': backup,
    'load-logs': loadLogs,
    'load-role-avatar': loadRoleAvatar,
    'draw-role-avatar': drawRoleAvatar,
    'load-banner-bg': loadBannerBg,
    'load-image-tool': loadImageTool,
    'render-admin-users': renderAdminUsers,
  };
  if (action === 'download-canvas') return downloadCanvas(el.dataset.canvas, el.dataset.filename || 'download.png');
  if (action === 'rotate-image') return rotateImage(Number(el.dataset.deg) || 0);
  if (action === 'delete-chat') return deleteChat(el.dataset.id);
  if (action === 'add-achievement') return addAchievement(el.dataset.id);
  if (action === 'ban-user') return ban(el.dataset.id, el.dataset.banned === 'true');
  if (action === 'set-role') return setRole(el.dataset.id, el.value);
  const fn = actions[action];
  if (fn) return fn();
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
      } catch (err) {
        console.error(err);
        alert(err.message || 'Có lỗi xảy ra');
      }
    }
  });
  document.addEventListener('change', event => {
    const el = event.target.closest('[data-change-action]');
    if (el) runUiAction(el.dataset.changeAction, el);
  });
  document.addEventListener('input', event => {
    const el = event.target.closest('[data-input-action]');
    if (el) runUiAction(el.dataset.inputAction, el);
  });
  document.addEventListener('keydown', event => {
    const el = event.target.closest('[data-enter-action]');
    if (el && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      runUiAction(el.dataset.enterAction, el);
    }
  });
}

function renderProfile() {
  const m = meta(me.role);
  $('#profileAvatarWrap').className = `role-avatar ${m.key} hero`;
  $('#avatar').src = avatarOf(me);
  $('#name').textContent = me.displayName;
  $('#role').className = `role role-${m.key}`;
  $('#role').textContent = `${m.icon} ${m.label}`;
  $('#profilePageAvatarWrap').className = `role-avatar ${m.key} hero`;
  $('#profilePageAvatar').src = avatarOf(me);
  $('#profilePageName').textContent = me.displayName;
  $('#profilePageRole').className = `role role-${m.key}`;
  $('#profilePageRole').textContent = `${m.icon} ${m.label}`;
  $('#profileJoinDate').textContent = `Tham gia: ${fmtDate(me.createdAt)}`;
  $('#newName').value = me.displayName || '';
  $('#bio').value = me.bio || '';
  $('#games').value = me.games || '';
  $('#gameId').value = me.gameId || '';
  $('#discord').value = me.discord || '';
  renderAchievements(me.achievements || []);
}
function renderAchievements(items) {
  $('#achievementCount').textContent = `${items.length} thành tích`;
  $('#achievementList').innerHTML = items.length ? items.map(a => `<article class="achievement"><div class="achievement-icon">${esc(a.icon || '🏆')}</div><div><b>${esc(a.title)}</b><p>${esc(a.description || '')}</p><small>Trao bởi ${esc(a.awardedBy || 'Hệ thống')} • ${fmtDate(a.awardedAt)}</small></div></article>`).join('') : '<p class="muted">Chưa có thành tích được trao.</p>';
}
async function show() {
  if (!me) { try { me = (await api('/api/me')).user; } catch { return; } }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#adminNav').hidden = !['Boss','Kì Cựu'].includes(me.role);
  renderProfile();
  await Promise.all([members(), music(), adminUsers()]);
  setupRoutes();
  routeTo(location.hash.slice(1) || 'overview');
}
async function saveProfile() {
  try {
    me = (await api('/api/profile', { method: 'POST', body: JSON.stringify({ displayName: $('#newName').value, bio: $('#bio').value, games: $('#games').value, gameId: $('#gameId').value, discord: $('#discord').value }) })).user;
    renderProfile(); await members(); alert('Đã lưu hồ sơ.');
  } catch (e) { alert(e.message); }
}
async function uploadAvatar() {
  const f = $('#avatarFile').files[0]; if (!f) return alert('Chọn ảnh trước');
  const fd = new FormData(); fd.append('avatar', f);
  const r = await fetch('/api/avatar', { method: 'POST', body: fd }); const j = await r.json();
  if (!r.ok) return alert(j.error || 'Không thể tải avatar'); me = j.user; renderProfile(); members();
}
async function members() {
  if (!me) return;
  const a = (await api('/api/members')).members; const online = a.filter(u => u.online).length;
  $('#memberCount').textContent = `${online} online / ${a.length} thành viên`;
  $('#memberList').innerHTML = a.map(u => { const m = meta(u.role); return `<div class="member role-card-${m.key}">${avatarHTML(u)}<span class="dot ${u.online ? 'on' : ''}" title="${u.online ? 'Đang online' : 'Offline'}"></span><div class="member-info"><b>${esc(u.displayName)}</b><span class="mini-role ${m.key}">${m.icon} ${m.label}</span><small>${esc(u.games || '')}</small></div></div>`; }).join('');
}

async function music() {
  if (!me) return; const a = (await api('/api/music')).music;
  $('#musicList').innerHTML = a.length ? a.map(m => `<div class="music"><b>${esc(m.title)}</b><br><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.url)}</a><br><small>Thêm bởi ${esc(m.addedBy)}</small></div>`).join('') : '<p class="muted">Chưa có bài nhạc nào được lưu.</p>';
}
async function addMusic() { try { await api('/api/music', { method: 'POST', body: JSON.stringify({ title: $('#musicTitle').value, url: $('#musicUrl').value }) }); $('#musicUrl').value = ''; $('#musicTitle').value = ''; music(); } catch (e) { alert(e.message); } }

function stopChatTimer() { if (chatTimer) clearInterval(chatTimer); chatTimer = null; }
function startChatTimer() { stopChatTimer(); chatTimer = setInterval(loadChat, 3500); }
async function loadChat() {
  if (!me || $('[data-section="chat"]')?.hidden) return;
  try {
    const j = await api('/api/chat'); const box = $('#chatMessages'); const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = j.messages.length ? j.messages.map(m => { const rm = meta(m.role); const canDelete = m.mine || ['Boss','Kì Cựu'].includes(me.role); return `<div class="chat-message ${m.mine ? 'mine' : ''}">${avatarHTML(m)}<div class="chat-bubble"><div class="chat-head"><b>${esc(m.displayName)}</b><span class="mini-role ${rm.key}">${rm.icon} ${rm.label}</span><small>${fmtDate(m.createdAt)}</small></div><p>${esc(m.text)}</p>${canDelete ? `<button class="tiny danger" data-action="delete-chat" data-id="${esc(m.id)}">Xóa</button>` : ''}</div></div>`; }).join('') : '<p class="muted">Chưa có tin nhắn. Hãy bắt đầu cuộc trò chuyện.</p>';
    if (nearBottom) box.scrollTop = box.scrollHeight;
  } catch {}
}
async function sendChat() { const input = $('#chatInput'); const text = input.value.trim(); if (!text) return; try { await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) }); input.value = ''; await loadChat(); } catch (e) { alert(e.message); } }
async function deleteChat(id) { try { await api('/api/chat/' + id, { method: 'DELETE' }); loadChat(); } catch (e) { alert(e.message); } }

async function adminUsers() { if (!me || !['Boss','Kì Cựu'].includes(me.role)) return; adminCache = (await api('/api/admin/users')).users; renderAdminUsers(); }
function renderAdminUsers() {
  if (!$('#users') || !me || !['Boss','Kì Cựu'].includes(me.role)) return;
  const q = ($('#adminSearch')?.value || '').trim().toLowerCase(); const a = adminCache.filter(u => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  $('#users').innerHTML = a.length ? a.map(u => { const m = meta(u.role); return `<div class="user role-card-${m.key}">${avatarHTML(u)}<div class="member-info"><b>${esc(u.displayName)}</b><small>@${esc(u.username)}</small><span class="mini-role ${m.key}">${m.icon} ${m.label}${u.banned ? ' • ⛔ BANNED' : ''}</span><small>${(u.achievements || []).length} thành tích</small></div><div class="admin-actions">${me.role === 'Boss' ? `<select data-change-action="set-role" data-id="${esc(u.id)}" aria-label="Đổi role"><option value="${esc(u.role)}">${esc(u.role)}</option>${['Boss','Kì Cựu','Member'].filter(r => r !== u.role).map(r => `<option value="${r}">${r}</option>`).join('')}</select>` : ''}<button data-action="add-achievement" data-id="${esc(u.id)}">🏆 Thành tích</button><button class="${u.banned ? 'unban' : 'ban'}" data-action="ban-user" data-id="${esc(u.id)}" data-banned="${!u.banned}">${u.banned ? 'Mở cấm' : 'Cấm'}</button></div></div>`; }).join('') : '<p class="muted">Không tìm thấy thành viên phù hợp.</p>';
}
async function addAchievement(id) {
  const target = adminCache.find(u => u.id === id);
  const title = prompt(`Tên thành tích cho ${target?.displayName || 'thành viên'}:`); if (!title) return;
  const description = prompt('Mô tả thành tích:', '') || '';
  const icon = prompt('Icon/emoji:', '🏆') || '🏆';
  try { await api(`/api/admin/user/${id}/achievement`, { method: 'POST', body: JSON.stringify({ title, description, icon }) }); await adminUsers(); if (id === me.id) { me = (await api('/api/me')).user; renderProfile(); } } catch (e) { alert(e.message); }
}
async function loadLogs() { const j = await api('/api/admin/logs'); const box = $('#logs'); box.hidden = !box.hidden; if (box.hidden) return; box.innerHTML = j.logs.length ? j.logs.map(l => `<div class="log-item"><b>${esc(l.action)}</b><span>${esc(l.by || l.user || 'Hệ thống')}${l.target ? ' → ' + esc(l.target) : ''}</span><small>${fmtDate(l.at)}</small></div>`).join('') : '<p class="muted">Chưa có nhật ký.</p>'; }
async function setRole(id, role) { await api('/api/admin/user/' + id, { method: 'POST', body: JSON.stringify({ role }) }); if (id === me.id) me = (await api('/api/me')).user; renderProfile(); await Promise.all([adminUsers(), members()]); }
async function ban(id, banned) { if (id === me.id && !confirm('Bạn đang thao tác trên chính tài khoản của mình. Tiếp tục?')) return; await api('/api/admin/user/' + id, { method: 'POST', body: JSON.stringify({ banned }) }); await Promise.all([adminUsers(), members()]); }
async function backup() { const j = await api('/api/backup', { method: 'POST' }); alert('Đã backup: ' + j.file); }

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
  const text = $('#qrText').value.trim(); if (!text) return alert('Nhập nội dung QR trước.');
  try { const r = await fetch(`/api/tools/qr?text=${encodeURIComponent(text)}&size=${encodeURIComponent($('#qrSize').value)}`); if (!r.ok) throw Error((await r.json()).error || 'Không thể tạo QR'); const blob = await r.blob(); if (qrBlobUrl) URL.revokeObjectURL(qrBlobUrl); qrBlobUrl = URL.createObjectURL(blob); $('#qrPreview').src = qrBlobUrl; $('#qrHint').hidden = true; } catch (e) { alert(e.message); }
}
function downloadQR() { if (!qrBlobUrl) return alert('Tạo QR trước.'); const a=document.createElement('a'); a.href=qrBlobUrl; a.download='giatoc-qr.png'; a.click(); }

async function postFiles(url, field, files, statusText) {
  const fd = new FormData(); [...files].forEach(f => fd.append(field, f)); $('#pdfStatus').textContent = statusText;
  const r = await fetch(url, { method:'POST', body:fd }); if (!r.ok) { const j = await r.json().catch(()=>({})); throw Error(j.error || 'Không thể xử lý file'); }
  const blob = await r.blob(); const disposition = r.headers.get('Content-Disposition') || ''; const match = disposition.match(/filename="?([^";]+)"?/i); const filename = match?.[1] || 'download.pdf'; const a=document.createElement('a'); const u=URL.createObjectURL(blob); a.href=u; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(u),5000); $('#pdfStatus').textContent = `✅ Hoàn tất: ${filename}`;
}
async function mergePDFs() { const f=$('#mergePdfFiles').files; if (f.length<2) return alert('Chọn ít nhất 2 PDF.'); try { await postFiles('/api/tools/pdf/merge','pdfs',f,'Đang gộp PDF...'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; } }
async function imagesToPDF() { const f=$('#imagesToPdf').files; if (!f.length) return alert('Chọn ảnh trước.'); try { await postFiles('/api/tools/pdf/images-to-pdf','images',f,'Đang chuyển ảnh sang PDF...'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; } }
async function compressPDF() { const f=$('#compressPdfFile').files; if (!f.length) return alert('Chọn PDF trước.'); try { await postFiles('/api/tools/pdf/compress','pdf',f,'Đang tối ưu PDF...'); } catch(e){ $('#pdfStatus').textContent='❌ '+e.message; } }

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
setInterval(() => { if (me) fetch('/api/ping', { method: 'POST' }).then(() => members()).catch(()=>{}); }, 60000);
window.addEventListener('error', event => console.error('UI error:', event.error || event.message));
window.addEventListener('unhandledrejection', event => console.error('Promise error:', event.reason));
setupInteractions();
if (location.protocol === 'file:') {
  msg('⚠️ Không mở index.html trực tiếp. Hãy chạy npm install → npm start rồi mở http://localhost:3000');
}
window.addEventListener('load', () => { drawRoleAvatar(); drawBanner(); });
show();
