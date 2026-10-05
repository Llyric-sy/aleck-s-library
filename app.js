const $ = s => document.querySelector(s);
const state = {
  catalog: [],
  filtered: [],
  currentBook: null,
  chapterIndex: 0,
  theme: localStorage.getItem('theme') || 'dark',
  localBooks: new Set(),
  pendingImportSlug: null,
  epubBook: null,
  epubRendition: null,
  objectUrl: null
};

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

// Local book storage. Imported files stay on this device and remain available offline.
const DB_NAME = 'alecks-library';
const DB_VERSION = 1;
const STORE = 'books';

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE,{keyPath:'slug'}); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function dbPut(record){
  const db=await openDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
}

async function dbGet(slug){
  const db=await openDb();
  const result=await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).get(slug);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
  db.close();
  return result;
}

async function dbKeys(){
  const db=await openDb();
  const keys=await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');
    const req=tx.objectStore(STORE).getAllKeys();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
  db.close();
  return keys;
}

async function refreshLocalBooks(){
  try{
    state.localBooks = new Set(await dbKeys());
    renderBooks();
  }catch(e){ console.warn('Local library unavailable', e); }
}

async function loadCatalog(){
  const res = await fetch('./books/catalog.json');
  if(!res.ok) throw new Error('Could not load catalog');
  state.catalog = await res.json();
  state.filtered = state.catalog;
  populateAuthors();
  await refreshLocalBooks();
  $('#syncStatus').textContent = `${state.catalog.length} books in library · imported books stay offline`;
  autoCacheLibrary();
}

function populateAuthors(){
  const authors = [...new Set(state.catalog.map(b => b.author))].sort();
  $('#authorFilter').innerHTML = '<option value="">All authors</option>' + authors.map(a => `<option>${escapeHtml(a)}</option>`).join('');
}

function escapeHtml(v=''){
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderBooks(){
  if(!state.catalog.length) return;
  const q = $('#searchInput').value.trim().toLowerCase();
  const author = $('#authorFilter').value;
  state.filtered = state.catalog.filter(b => (!author || b.author === author) && (!q || (b.title+' '+b.author).toLowerCase().includes(q)));
  $('#bookGrid').innerHTML = state.filtered.length ? state.filtered.map(card).join('') : '<div class="empty">No matching books.</div>';
  document.querySelectorAll('[data-book]').forEach(btn => btn.addEventListener('click', () => openBook(btn.dataset.book)));
}

function card(b){
  const packaged = Array.isArray(b.chapters) && b.chapters.length > 0;
  const local = state.localBooks.has(b.slug);
  const localCover = b.cover && b.cover.startsWith('./') ? b.cover.slice(2) : b.cover;
  const coverSrc = localCover ? (localCover.startsWith('http') ? localCover : './'+localCover) : '';
  const cover = coverSrc ? `<img src="${coverSrc}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
  let status = 'Add your copy';
  if(local) status = 'On this device · offline';
  else if(packaged) status = b.chapters.length+' chapters';
  return `<article class="book-card">
    <button class="cover-button" data-book="${b.slug}" aria-label="Open ${escapeHtml(b.title)}">
      <div class="cover">
        ${cover}
        <div class="cover-fallback"><strong>${escapeHtml(b.title)}</strong><span>${escapeHtml(b.author)}</span></div>
      </div>
      <p class="book-title">${escapeHtml(b.title)}</p>
      <p class="book-author">${escapeHtml(b.author)}</p>
      <div class="book-meta ${local?'local-ready':''}"><span class="dot ${(local||packaged)?'ready':''}"></span><span>${status}</span></div>
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
  }catch{}
}

async function openBook(slug){
  const book = state.catalog.find(b => b.slug === slug);
  if(!book) return;

  const local = await dbGet(slug);
  if(local){
    await openLocalBook(book, local);
    return;
  }

  if(book.chapters?.length){
    state.currentBook = book;
    const saved = Number(localStorage.getItem('progress:'+slug) || 0);
    state.chapterIndex = Math.min(saved, book.chapters.length-1);
    $('#libraryView').classList.add('hidden');
    $('#readerView').classList.remove('hidden');
    $('#readerTitle').textContent = book.title;
    $('#readerAuthor').textContent = book.author;
    await renderChapter();
    window.scrollTo({top:0});
    return;
  }

  // No public chapter payload: let the reader attach their own local copy instead.
  state.pendingImportSlug = slug;
  $('#bookFileInput').value = '';
  $('#bookFileInput').click();
}

$('#bookFileInput').addEventListener('change', async e => {
  const file=e.target.files?.[0];
  const slug=state.pendingImportSlug;
  state.pendingImportSlug=null;
  if(!file || !slug) return;

  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(!['epub','pdf','txt'].includes(ext)){
    alert('Choose an EPUB, PDF, or TXT copy of this book.');
    return;
  }

  try{
    await dbPut({
      slug,
      name:file.name,
      type:ext,
      mime:file.type || '',
      blob:file,
      savedAt:Date.now()
    });
    state.localBooks.add(slug);
    renderBooks();
    const book=state.catalog.find(b=>b.slug===slug);
    await openLocalBook(book, await dbGet(slug));
  }catch(err){
    console.error(err);
    alert('This browser could not save the book locally.');
  }
});

async function openLocalBook(book, record){
  cleanupLocalReader();
  $('#libraryView').classList.add('hidden');
  $('#readerView').classList.add('hidden');
  $('#fileReaderView').classList.remove('hidden');
  $('#fileReaderTitle').textContent = book.title;

  if(record.type === 'pdf'){
    $('#epubTools').classList.add('hidden');
    $('#pdfViewer').classList.remove('hidden');
    state.objectUrl=URL.createObjectURL(record.blob);
    $('#pdfViewer').src=state.objectUrl;
    return;
  }

  if(record.type === 'txt'){
    $('#epubTools').classList.add('hidden');
    $('#textViewer').classList.remove('hidden');
    const text=await record.blob.text();
    $('#textViewerBody').innerHTML=text.split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${escapeHtml(p.trim())}</p>`).join('');
    return;
  }

  if(record.type === 'epub'){
    if(typeof window.ePub !== 'function'){
      alert('The EPUB reader component has not loaded yet. Reopen the site once while online, then it will be cached for later.');
      closeFileReader();
      return;
    }
    $('#epubTools').classList.remove('hidden');
    $('#epubViewer').classList.remove('hidden');
    const buffer=await record.blob.arrayBuffer();
    state.epubBook=window.ePub(buffer);
    state.epubRendition=state.epubBook.renderTo('epubViewer',{width:'100%',height:'100%',spread:'none'});
    const saved=localStorage.getItem('epub-location:'+book.slug);
    await state.epubRendition.display(saved || undefined);
    state.epubRendition.themes.default({
      body:{'font-family':'Georgia, serif','line-height':'1.7','padding':'0 4%'},
      p:{'font-size':'1em'}
    });
    state.epubRendition.on('relocated', loc => {
      if(loc?.start?.cfi) localStorage.setItem('epub-location:'+book.slug, loc.start.cfi);
    });
  }
}

function cleanupLocalReader(){
  if(state.objectUrl){ URL.revokeObjectURL(state.objectUrl); state.objectUrl=null; }
  if(state.epubRendition){ try{state.epubRendition.destroy();}catch{} state.epubRendition=null; }
  if(state.epubBook){ try{state.epubBook.destroy();}catch{} state.epubBook=null; }
  $('#pdfViewer').src='about:blank';
  $('#pdfViewer').classList.add('hidden');
  $('#epubViewer').innerHTML='';
  $('#epubViewer').classList.add('hidden');
  $('#textViewer').classList.add('hidden');
  $('#textViewerBody').innerHTML='';
}

function closeFileReader(){
  cleanupLocalReader();
  $('#fileReaderView').classList.add('hidden');
  $('#libraryView').classList.remove('hidden');
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
    $('#chapterBody').innerHTML = '<p>This chapter is not cached and the connection is unavailable.</p>';
  }
}

$('#searchInput').addEventListener('input', renderBooks);
$('#authorFilter').addEventListener('change', renderBooks);
$('#backBtn').addEventListener('click', () => { $('#readerView').classList.add('hidden'); $('#libraryView').classList.remove('hidden'); });
$('#fileBackBtn').addEventListener('click', closeFileReader);
$('#epubPrev').addEventListener('click', () => state.epubRendition?.prev());
$('#epubNext').addEventListener('click', () => state.epubRendition?.next());
$('#prevChapter').addEventListener('click', async () => { if(state.chapterIndex>0){state.chapterIndex--; await renderChapter(); window.scrollTo({top:0,behavior:'smooth'});} });
$('#nextChapter').addEventListener('click', async () => { if(state.chapterIndex<state.currentBook.chapters.length-1){state.chapterIndex++; await renderChapter(); window.scrollTo({top:0,behavior:'smooth'});} });
$('#fontUp').addEventListener('click', () => changeFont(1));
$('#fontDown').addEventListener('click', () => changeFont(-1));
function changeFont(dir){
  const root=document.documentElement;
  const current=parseFloat(getComputedStyle(root).getPropertyValue('--reader-size'));
  root.style.setProperty('--reader-size', Math.max(15,Math.min(28,current+dir))+'px');
}
$('#themeBtn').addEventListener('click', () => {
  const seq=['dark','light','sepia'];
  setTheme(seq[(seq.indexOf(state.theme)+1)%seq.length]);
});

$('#cacheAllBtn').addEventListener('click', async () => {
  await autoCacheLibrary();
  $('#syncStatus').textContent = 'App and covers cached; imported books are already stored offline';
});

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js?v=4').catch(console.error);
}

loadCatalog().catch(err => {
  $('#bookGrid').innerHTML = '<div class="empty">Library catalog could not be loaded.</div>';
  $('#syncStatus').textContent = err.message;
});