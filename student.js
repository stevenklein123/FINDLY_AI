const API_URL = 'http://127.0.0.1:5000'; // change to your hosted backend URL after deploying
const $ = s => document.querySelector(s);
const screens = {home:$('#home'), report:$('#report'), match:$('#match')};
let mode = 'lost', history = ['home'];

/* Guard: only signed-in students can see this page */
(async () => {
  const user = await FindlyAuth.getUser();
  if (!user) { window.location.replace('index.html'); return; }
  const md = user.user_metadata || {};
  const name = md.full_name || md.name || user.email || 'QCUian';
  $('#who').textContent = name.split(' ')[0];
  document.querySelector('.app').hidden = false;
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
$('#bell').onclick = () => { if (!$('#notif').hidden) go('match'); else toast('No new notifications'); };

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

$('#reportForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!$('#photo').files[0]) return toast('Please add a photo first');
  if (!fd.get('item').trim() || !fd.get('place').trim()) return toast('Fill in the item name and location');
  const when = $('#nowBtn').classList.contains('on') ? new Date() : null;
  const stamp = when ? when.toLocaleDateString('en-US') + ' ' + when.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : $('#time').value;
  /* TODO: save report to Supabase + run AI image match here */
  if (mode === 'found') {
    toast('Found item submitted. Please bring it to the Admin.');
    e.target.reset(); $('#preview').style.display = 'none'; history = ['home']; show('home');
  } else {
    $('#mName').textContent = fd.get('item');
    $('#mCat').textContent = fd.get('category') || '—';
    $('#mDesc').textContent = [fd.get('color'), fd.get('brand'), fd.get('marks')].filter(Boolean).join(', ') || '—';
    $('#mLoc').textContent = fd.get('place');
    $('#mWhen').textContent = stamp;
    $('#matchImg').style.display = 'block';
    $('#notif').hidden = false;
    go('match');
  }
});
$('#claimBtn').onclick = () => { toast('Claim submitted. The admin will verify ownership.'); history = ['home']; show('home'); };

let tt; function toast(m){ const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3200); }
setupReport();