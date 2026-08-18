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

  // .tab-btn now lives on the bottom nav (index.html) rather than an
  // off-canvas drawer — same class, same wiring, no drawer left to close.
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.subtab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=> switchAdminSubtab(btn.dataset.subtab));
  });
  document.getElementById('adminHelpBtn').addEventListener('click', ()=> showAlert('Series, fixtures and player pools — visible only to admin accounts. Leagues are self-service now: anyone can create or join one under My Leagues.', 'Admin'));

  // The bottom nav's Profile item just opens the account overlay directly —
  // it's not a real tab-panel, so it doesn't go through switchTab()/the
  // .tab-btn wiring above.
  document.getElementById('profileNavBtn').addEventListener('click', openAccountOverlay);

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

/* Stays a plain (non-async) function on purpose — every existing caller
   fires it and moves on without awaiting a result, and that keeps working
   whether or not this particular call ends up going through the confirm
   below: the common case (not leaving My XI, or leaving it with nothing
   uncommitted) still applies the switch synchronously, exactly as before;
   only "leaving My XI with unsaved changes" branches into the async confirm
   and applies the switch afterward instead, once the user's answered it. */
function switchTab(tab){
  if(tab==='admin' && !isAdmin) tab = 'home';
  const activePanel = document.querySelector('.tab-panel.active');
  const leavingMyXi = activePanel && activePanel.id==='tab-myxi' && tab!=='myxi';
  if(leavingMyXi && hasUncommittedMyXiChanges()){
    showConfirm("You've made changes in My Squads that you haven't confirmed yet — they're saved and will still be here, but they won't count for scoring until you hit Confirm. Leave without confirming?", 'Uncommitted changes').then(ok=>{
      if(ok) applyTabSwitch(tab);
    });
    return;
  }
  applyTabSwitch(tab);
}
function applyTabSwitch(tab){
  document.querySelectorAll('.tab-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p=> p.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if(tab==='home') renderHome();
  if(tab==='leaderboard') renderLeaderboard();
  if(tab==='myxi') renderMyXI();
  if(tab==='admin') switchAdminSubtab('setup');
}

function renderAll(){
  if(isAdmin){ renderSeriesSetup(); renderMatchSetup(); }
  renderHome();
  renderMyXI();
  renderLeaderboard();
}



init().catch(e=>{
  console.error('Fatal init error', e);
  const box = document.getElementById('authRow');
  if(box) box.innerHTML = `<span class="auth-error">Failed to start: ${e.message||e}. Check the browser console for details.</span>`;
});
