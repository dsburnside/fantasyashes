/* js/init.js — defines init()/switchTab()/renderAll() and, at the very bottom, actually starts the app.
   Loads LAST — every other js/*.js file is pure declarations (no top-level side effects), so this is the
   only file whose load position matters; it must come after all the others in index.html. */
/* ================= INIT ================= */
async function init(){
  const joinParam = new URLSearchParams(window.location.search).get('join');
  if(joinParam){
    pendingJoinCode = joinParam.trim().toUpperCase();
    history.replaceState(null, '', window.location.pathname);
  }

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      switchTab(btn.dataset.tab);
      closeMobileDrawer();
    });
  });
  document.querySelectorAll('.subtab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchAdminSubtab(btn.dataset.subtab));
  });

  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  const tabnavBackdrop = document.getElementById('tabnavBackdrop');
  hamburgerBtn.addEventListener('click', openMobileDrawer);
  drawerCloseBtn.addEventListener('click', closeMobileDrawer);
  tabnavBackdrop.addEventListener('click', closeMobileDrawer);
  document.getElementById('profileBtn').addEventListener('click', openAccountOverlay);

  if(!supabaseClient){
    renderAuthRow();
    return;
  }

  try{
    const {data, error} = await supabaseClient.auth.getSession();
    if(error) throw error;
    session = data.session;
  }catch(e){
    console.error('getSession failed', e);
  }
  renderAuthRow(); // show something immediately, don't wait on the rest
  if(!session) showLoginOverlay(true); // dismissible — Rules is still browsable without an account

  supabaseClient.auth.onAuthStateChange(async (event, newSession)=>{
    session = newSession;
    // Supabase fires one or more of these on startup (INITIAL_SESSION and/or
    // others depending on version/scenario) on top of the sequential load
    // below already handling first load — letting both run the full load
    // concurrently is a race (whichever finishes last wins), and it
    // flip-flopped isAdmin back to false in practice. Rather than guess at
    // exact event names, just defer to the sequential flow entirely until
    // it's finished; `session` above is still kept current in the meantime.
    if(!didInitialLoad) return;
    try{ await loadIsAdmin(); }catch(e){ console.error(e); }
    try{ await loadMySquads(); await loadMyLeagues(); await loadCurrentSeriesData(); }catch(e){ console.error(e); }
    if(isAdmin && !adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
    renderAuthRow();
    updateAdminTabVisibility();
    renderAll();
    renderCountdown();
    applyPendingJoinCode();
  });

  try{
    await loadTeamsList();
    await loadVenuesList();
    await loadSeriesList();
    await loadIsAdmin();
    await loadMySquads();
    await loadMyLeagues();
    await loadCurrentSeriesData();
    if(isAdmin && !adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  }catch(e){
    console.error('Initial data load failed', e);
    const box = document.getElementById('authRow');
    box.innerHTML += `<span class="auth-error">Could not reach the database — check the schema has been run and the URL/key are correct (${e.message||e}).</span>`;
  }
  didInitialLoad = true;

  renderAuthRow();
  updateAdminTabVisibility();
  renderAll();
  startCountdown();
  applyPendingJoinCode();
}

/* Jumps to the My Leagues tab and pre-fills its join-code field from a
   ?join=CODE invite link (see "Copy invite link" in renderLeaderboard()) — a
   no-op until a session exists, so it's safe to call right after every load/
   auth-state pass; whichever one first finds a session applies it once. */
function applyPendingJoinCode(){
  if(!pendingJoinCode || !session) return;
  const code = pendingJoinCode;
  pendingJoinCode = null;
  switchTab('leaderboard');
  openLeagueAddOverlay();
  const backdrop = document.getElementById('appOverlay');
  if(!backdrop) return;
  backdrop.querySelector('[data-addsub="join"]')?.click();
  const input = backdrop.querySelector('#joinCodeInput');
  if(input){ input.value = code; input.focus(); }
}

function openMobileDrawer(){
  document.getElementById('tabnav').classList.add('open');
  document.getElementById('tabnavBackdrop').classList.add('open');
  document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'true');
}
function closeMobileDrawer(){
  document.getElementById('tabnav').classList.remove('open');
  document.getElementById('tabnavBackdrop').classList.remove('open');
  document.getElementById('hamburgerBtn').setAttribute('aria-expanded', 'false');
}

function switchTab(tab){
  if(tab==='admin' && !isAdmin) tab = 'rules';
  document.querySelectorAll('.tab-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p=> p.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if(tab==='leaderboard') renderLeaderboard();
  if(tab==='myxi') renderMyXI();
  if(tab==='admin') switchAdminSubtab('setup');
}

function renderAll(){
  if(isAdmin){ renderSeriesSetup(); renderMatchSetup(); }
  renderMyXI();
  renderLeaderboard();
}



init().catch(e=>{
  console.error('Fatal init error', e);
  const box = document.getElementById('authRow');
  if(box) box.innerHTML = `<span class="auth-error">Failed to start: ${e.message||e}. Check the browser console for details.</span>`;
});
