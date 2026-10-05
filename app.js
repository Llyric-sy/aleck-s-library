const $ = s => document.querySelector(s);
const state = { catalog: [], filtered: [], currentBook: null, chapterIndex: 0, theme: localStorage.getItem('theme') || 'dark' };

function setTheme(theme){
  document.body.classList.remove('light','sepia');
  if(theme !== 'dark') document.body.classList.add(theme);
  state.theme = theme;
  localStorage.setItem('theme', theme);
}

function updateNetwork(){
  $('#networkStatus').textContent = navigator.onLine ? 'Online' : 'Offline';
}
window.addEventListener('online', updateNetwork);
window.addEventListener('offline', updateNetwork);
updateNetwork();
setTheme(state.theme);

async function loadCatalog(){
  const res = await fetch('./books/catalog.json');
  if(!res.ok) throw new Error('Could not load catalog');
  state.catalog = await res.json();
  state.filtered = state.catalog;
  populateAuthors();
  renderBooks();
  $('#syncStatus').textContent = `${state.catalog.length} books in library`;
  autoCacheLibrary();
}

function populateAuthors(){
  const authors = [...new Set(state.catalog.map(b => b.author))].sort();
  $('#authorFilter').innerHTML = '<option value="">All authors</option>' + authors.map(a => `<option>${escapeHtml(a)}</option>`).join('');
}

function escapeHtml(v=''){
  return v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderBooks(){
  const q = $('#searchInput').value.trim().toLowerCase();
  const author = $('#authorFilter').value;
  state.filtered = state.catalog.filter(b => (!author || b.author === author) && (!q || (b.title+' '+b.author).toLowerCase().includes(q)));
  $('#bookGrid').innerHTML = state.filtered.length ? state.filtered.map(card).join('') : '<div class="empty">No matching books.</div>';
  document.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => openBook(btn.dataset.book)));
}

function card(b){
  const ready = Array.isArray(b.chapters) && b.chapters.length > 0;
  const cover = b.cover ? `<img src="./${b.cover}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  return `<article class="book-card">
    <button class="cover-button" data-book="${b.slug}" aria-label="Open ${escapeHtml(b.title)}">
      <div class="cover">
        ${cover}
        <div class="cover-fallback"><strong>${escapeHtml(b.title)}</strong><span>${escapeHtml(b.author)}</span></div>
      </div>
      <p class="book-title">${escapeHtml(b.title)}</p>
      <p class="book-author">${escapeHtml(b.author)}</p>
      <div class="book-meta"><span class="dot ${ready?'ready':''}"></span><span>${ready ? b.chapters.length+' chapters' : 'Not packaged yet'}</span></div>
    </button>
  </article>`;
}

function libraryAssetList(){
  return state.catalog.flatMap(b => [b.cover, ...(b.chapters||[])]).filter(Boolean);
}

async function autoCacheLibrary(){
  if(!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active || reg.waiting || reg.installing;
    const all = libraryAssetList();
    if(!all.length) return;
    worker?.postMessage({type:'CACHE_LIBRARY', urls:all});
    $('#syncStatus').textContent = 'Syncing library for offline reading…';
  }catch{}
}

async function openBook(slug){
  const book = state.catalog.find(b => b.slug === slug);
  if(!book || !book.chapters?.length){
    alert('This book is listed, but its chapter text has not been packaged into the site yet.');
    return;
  }
  state.currentBook = book;
  const saved = Number(localStorage.getItem('progress:'+slug) || 0);
  state.chapterIndex = Math.min(saved, book.chapters.length-1);
  $('#libraryView').classList.add('hidden');
  $('#readerView').classList.remove('hidden');
  $('#readerTitle').textContent = book.title;
  $('#readerAuthor').textContent = book.author;
  await renderChapter();
  window.scrollTo({top:0});
}

async function renderChapter(){
  const b = state.currentBook;
  const idx = state.chapterIndex;
  const path = './' + b.chapters[idx];
  $('#chapterLabel').textContent = `Chapter ${idx+1} of ${b.chapters.length}`;
  $('#chapterBody').innerHTML = '<p>Loading…</p>';
  try{
    const res = await fetch(path);
    if(!res.ok) throw new Error();
    const data = await res.json();
    $('#chapterLabel').textContent = data.title || `Chapter ${idx+1}`;
    const paras = Array.isArray(data.paragraphs) ? data.paragraphs : String(data.text||'').split(/\n\s*\n/);
    $('#chapterBody').innerHTML = paras.filter(Boolean).map(p => `<p>${escapeHtml(String(p).trim())}</p>`).join('');
    localStorage.setItem('progress:'+b.slug, String(idx));
    $('#prevChapter').disabled = idx === 0;
    $('#nextChapter').disabled = idx === b.chapters.length-1;
  }catch{
    $('#chapterBody').innerHTML = '<p>This chapter is not cached and the connection is unavailable. Try again when a connection returns.</p>';
  }
}

$('#searchInput').addEventListener('input', renderBooks);
$('#authorFilter').addEventListener('change', renderBooks);
$('#backBtn').addEventListener('click', () => { $('#readerView').classList.add('hidden'); $('#libraryView').classList.remove('hidden'); });
$('#prevChapter').addEventListener('click', async () => { if(state.chapterIndex>0){state.chapterIndex--; await renderChapter(); window.scrollTo({top:0,behavior:'smooth'});} });
$('#nextChapter').addEventListener('click', async () => { if(state.chapterIndex<state.currentBook.chapters.length-1){state.chapterIndex++; await renderChapter(); window.scrollTo({top:0,behavior:'smooth'});} });
$('#fontUp').addEventListener('click', () => changeFont(1));
$('#fontDown').addEventListener('click', () => changeFont(-1));
function changeFont(dir){ const root=document.documentElement; const current=parseFloat(getComputedStyle(root).getPropertyValue('--reader-size')); root.style.setProperty('--reader-size', Math.max(15,Math.min(28,current+dir))+'px'); }
$('#themeBtn').addEventListener('click', () => { const seq=['dark','light','sepia']; setTheme(seq[(seq.indexOf(state.theme)+1)%seq.length]); });

$('#cacheAllBtn').addEventListener('click', autoCacheLibrary);

navigator.serviceWorker?.addEventListener('message', e => {
  if(e.data?.type === 'CACHE_PROGRESS') $('#syncStatus').textContent = `Offline sync: ${e.data.done}/${e.data.total}`;
  if(e.data?.type === 'CACHE_DONE') $('#syncStatus').textContent = 'Library available offline on this device';
});

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

loadCatalog().catch(err => {
  $('#bookGrid').innerHTML = '<div class="empty">Library catalog could not be loaded.</div>';
  $('#syncStatus').textContent = err.message;
});