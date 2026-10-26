const API_URL = 'https://findly-ai-v6k7.onrender.com'; // change to your hosted backend URL after deploying
const $ = s => document.querySelector(s);
const screens = {home:$('#home'), report:$('#report'), match:$('#match'), notifs:$('#notifs')};
let mode = 'lost', history = ['home'];
let notifs = [];

/* Guard: only signed-in students can see this page */
(async () => {
  const user = await FindlyAuth.getUser();
  if (!user) { window.location.replace('index.html'); return; }
  const md = user.user_metadata || {};
  const name = md.full_name || md.name || user.email || 'QCUian';
  $('#who').textContent = name.split(' ')[0];
  document.querySelector('.app').hidden = false;
  loadNotifs(user);
  const intent = sessionStorage.getItem('findly_intent');
  if (intent) { sessionStorage.removeItem('findly_intent'); go(intent); }
})();
$('#signOut').onclick = async () => {
  await FindlyAuth.signOut();
  window.location.replace('index.html');
};

function show(name){
  Object.values(screens).forEach(s => s.classList.remove('on'));
  const key = (name === 'found' || name === 'lost') ? 'report' : name;
  screens[key].classList.add('on');
  const isHome = key === 'home';
  $('#back').hidden = isHome; $('#seal').style.display = isHome ? '' : 'none'; $('#bell').style.visibility = isHome ? '' : 'hidden'; $('#signOut').style.display = isHome ? '' : 'none';
  $('#title').textContent = key === 'report' ? (mode === 'found' ? 'Report Found Item' : 'Report Missing Item') : screens[key].dataset.title;
  window.scrollTo(0,0);
}
function go(name){
  if (name === 'found' || name === 'lost') { mode = name; setupReport(); }
  history.push(name); show(name);
}
function setupReport(){
  const f = mode === 'found';
  $('#dropHint').textContent = f ? 'You will surrender the item to the Admin' : 'AI analyzes your photo to find a match';
  $('.q').textContent = f ? 'Where did you find the item?' : 'Where did you lose the item?';
  $('.q2').textContent = f ? 'When did you find the item?' : 'When did you lose the item?';
  $('#submitBtn').textContent = f ? 'Submit Found Item' : 'Submit and Find Match';
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]'); if (t) go(t.dataset.go);
});
$('#back').onclick = () => { history.pop(); show(history[history.length-1] || 'home'); };
$('#bell').onclick = () => {
  if (notifs.length) go('notifs');
  else if (!$('#notif').hidden) go('match');
  else toast('No new notifications');
};
/* photo preview */
$('#photo').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  $('#preview').src = url; $('#preview').style.display = 'block';
  $('#matchImg').src = url;
};

/* AI: read the photo (via the Flask backend) and fill in the form */
async function analyzePhoto(e){
  const file = e.target.files[0]; if (!file) return;
  const hint = $('#dropHint'), old = hint.textContent;
  hint.textContent = 'Analyzing photo…';
  try {
    const image = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000); // stop waiting after 60s
    const res = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mimeType: file.type }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (!res.ok || data?.error) throw new Error(data?.error || 'Request failed');
    const form = $('#reportForm');
    ['item','category','color','brand','size','marks','desc'].forEach(k => {
      const el = form.querySelector(`[name="${k}"]`);
      if (el && data[k]) el.value = data[k];
    });
    toast('Details filled in. Please check them.');
  } catch (err) {
    console.error('analyze error:', err);
    toast('Could not analyze the photo. Fill in the details manually.');
  } finally { hint.textContent = old; }
}
$('#photo').addEventListener('change', analyzePhoto);

/* time chips */
$('#nowBtn').onclick = () => { $('#nowBtn').classList.add('on'); $('#timeBtn').classList.remove('on'); $('#time').disabled = true; };
$('#timeBtn').onclick = () => { $('#timeBtn').classList.add('on'); $('#nowBtn').classList.remove('on'); $('#time').disabled = false; $('#time').focus(); };

$('#reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!$('#photo').files[0]) return toast('Please add a photo first');
  if (!fd.get('item').trim() || !fd.get('place').trim()) return toast('Fill in the item name and location');
  const when = $('#nowBtn').classList.contains('on') ? new Date() : null;
  const stamp = when ? when.toLocaleDateString('en-US') + ' ' + when.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : $('#time').value;
  let occurredAt = new Date();
  if (!when) {
    const m = $('#time').value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return toast('Enter the time like 02:30 PM');
    let h = Number(m[1]) % 12; if (m[3].toUpperCase() === 'PM') h += 12;
    occurredAt.setHours(h, Number(m[2]), 0, 0);
  }
  const user = await FindlyAuth.getUser();
  const sb = FindlyAuth.client;
  const file = $('#photo').files[0];
  const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`;
  let claimId;
  $('#submitBtn').disabled = true;
  try {
    const up = await sb.storage.from('item-images').upload(path, file);
    if (up.error) { console.error(up.error); return toast('Photo upload failed: ' + up.error.message); }
    const { data: row, error } = await sb.from(mode === 'found' ? 'found_items' : 'claim_items').insert({
      photo_url: sb.storage.from('item-images').getPublicUrl(path).data.publicUrl,
      item_name: fd.get('item').trim(),
      category: fd.get('category') || null,
      color: fd.get('color') || null,
      brand: fd.get('brand') || null,
      size: fd.get('size') || null,
      marks: fd.get('marks') || null,
      description: fd.get('desc') || null,
      place: fd.get('place').trim(),
      occurred_at: occurredAt.toISOString(),
      user_id: user.id,
      submitted_by: (user.user_metadata?.full_name || user.user_metadata?.name || user.email)
    }).select('id').single();
    claimId = row?.id;
    if (error) { console.error(error); return toast('Could not save: ' + error.message); }
  } catch (err) {
    console.error(err);
    return toast('Network problem. Please try again.');
  } finally {
    $('#submitBtn').disabled = false;
  }

  if (mode === 'found') {
    toast('Found item submitted. Please bring it to the Admin.');
    e.target.reset(); $('#preview').style.display = 'none'; history = ['home']; show('home');
  } else {
    let m = null;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch(`${API_URL}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ claim_id: claimId })
      });
      const j = await r.json();
      if (r.ok) m = j.match;
    } catch (err) { console.error('match error:', err); }
    if (!m) {
      toast("No match yet. We'll notify you when it's found.");
      e.target.reset(); $('#preview').style.display = 'none';
      history = ['home']; show('home'); return;
    }
    $('#mName').textContent = m.item_name;
    $('#mCat').textContent = m.category || '—';
    $('#mDesc').textContent = [m.color, m.brand, m.marks].filter(Boolean).join(', ') || '—';
    $('#mLoc').textContent = m.place;
    $('#mWhen').textContent = new Date(m.occurred_at).toLocaleString('en-US');
    $('#matchImg').src = m.photo_url; $('#matchImg').style.display = 'block';
    $('#pct').textContent = `${m.score}% Match`;
    $('#notifPct').textContent = `${m.score}% match`;
    $('#notif').hidden = false;
    go('match');
  }
});
$('#claimBtn').onclick = () => { toast('Claim submitted. The admin will verify ownership.'); history = ['home']; show('home'); };

let tt; function toast(m){ const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }

/* progress notifications */
async function loadNotifs(user){
  const sb = FindlyAuth.client;
  const [f, c] = await Promise.all([
    sb.from('found_items').select('id,item_name').eq('user_id', user.id).eq('status','claimed').eq('notified', false),
    sb.from('claim_items').select('id,item_name').eq('user_id', user.id).eq('status','found')
  ]);
  notifs = [
    ...(c.data || []).map(r => ({table:'claim_items', id:r.id, msg:`Your missing item (${r.item_name}) has been found. Please claim it at the Admin.`})),
    ...(f.data || []).map(r => ({table:'found_items', id:r.id, msg:`Your found item (${r.item_name}) has been claimed by its owner. Thank you!`}))
  ];

  const list = $('#notifList'); list.innerHTML = '';
  if (!notifs.length) list.textContent = 'No notifications.';
  notifs.forEach(n => {
    const d = document.createElement('div'); d.className = 'notif';
    d.innerHTML = '<div class="thumb"></div><p><b>NOTIFICATION</b></p>';
    d.querySelector('p').append(n.msg);
    if (n.table === 'found_items') {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'OK';
      b.onclick = async () => {
        await sb.from('found_items').update({notified:true}).eq('id', n.id);
        loadNotifs(user);
      };
      d.append(b);
    }
    list.append(d);
  });

  const banner = $('#notifBanner'); banner.innerHTML = '';
  if (notifs.length) {
    const d = document.createElement('div'); d.className = 'notif';
    d.innerHTML = '<div class="thumb"></div><p><b>NOTIFICATION</b></p>';
    d.querySelector('p').append(notifs[0].msg + (notifs.length > 1 ? ` (+${notifs.length - 1} more)` : ''));
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'View';
    b.onclick = () => go('notifs');
    d.append(b); banner.append(d);
  }
}
setupReport();