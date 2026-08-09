/* js/auth.js — the top-bar auth-state row (renderAuthRow). */
/* ================= AUTH ================= */
/* Account state now lives behind the profile icon (openAccountOverlay())
   rather than a persistent topbar row — this just keeps the config-error
   banner current and gives the icon a visual signed-in/out state. */
function renderAuthRow(){
  const box = document.getElementById('authRow');
  box.innerHTML = !supabaseClient
    ? `<span class="auth-error">Supabase isn't configured yet — paste your Project URL and anon key into SUPABASE_URL / SUPABASE_ANON_KEY near the top of the script.</span>`
    : '';
  const profileBtn = document.getElementById('profileBtn');
  if(profileBtn) profileBtn.classList.toggle('is-signed-in', !!session);
}

/* Profile icon: not signed in opens the same login/signup overlay as
   everywhere else; signed in opens account details + change password. */
function openAccountOverlay(){
  if(!session){ showLoginOverlay(true); return; }
  const backdrop = openOverlay(`
    <div class="overlay-title">Your account</div>
    <div class="overlay-message">
      Signed in as <strong>${myFirstName} ${myLastName}</strong> (${session.user.email})${isAdmin ? ' &middot; <span style="color:var(--gilt-bright);">admin</span>' : ''}<br>
      ${mySquad ? `Team: ${mySquad.teamName}` : 'No squad yet — build one in My XI.'}
    </div>
    <div class="field-group"><label for="acctNewPassword">New password</label><input type="password" id="acctNewPassword" placeholder="6+ characters"></div>
    <div class="field-group"><label for="acctNewPassword2">Confirm new password</label><input type="password" id="acctNewPassword2" placeholder="Repeat password"></div>
    <div class="auth-error" id="acctError"></div>
    <div class="overlay-actions" style="justify-content:space-between;">
      <button class="btn danger" id="acctLogoutBtn">Log out</button>
      <button class="btn" id="acctSavePasswordBtn">Update password</button>
    </div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  const errBox = backdrop.querySelector('#acctError');
  backdrop.querySelector('#acctSavePasswordBtn').addEventListener('click', async ()=>{
    errBox.textContent = '';
    const pw1 = backdrop.querySelector('#acctNewPassword').value;
    const pw2 = backdrop.querySelector('#acctNewPassword2').value;
    if(pw1.length < 6){ errBox.textContent = 'Password must be 6+ characters.'; return; }
    if(pw1 !== pw2){ errBox.textContent = "Passwords don't match."; return; }
    const {error} = await supabaseClient.auth.updateUser({password: pw1});
    if(error){ errBox.textContent = error.message; return; }
    closeOverlay();
    showAlert('Your password has been updated.', 'Password changed');
  });
  backdrop.querySelector('#acctLogoutBtn').addEventListener('click', async ()=>{
    closeOverlay();
    await supabaseClient.auth.signOut();
  });
}

/* Also loads first/last name alongside admin status — both live on the same
   profiles row, so one query covers both. */
async function loadIsAdmin(){
  if(!session){ isAdmin = false; myFirstName = ''; myLastName = ''; return; }
  const {data, error} = await supabaseClient.from('profiles').select('is_admin, first_name, last_name').eq('user_id', session.user.id).maybeSingle();
  if(error){ console.error(error); isAdmin = false; return; }
  isAdmin = !!(data && data.is_admin);
  myFirstName = (data && data.first_name) || '';
  myLastName = (data && data.last_name) || '';
}

function updateAdminTabVisibility(){
  const btn = document.querySelector('.tab-btn[data-tab="admin"]');
  if(!btn) return;
  btn.style.display = isAdmin ? '' : 'none';
  if(!isAdmin && document.getElementById('tab-admin').classList.contains('active')){
    switchTab('rules');
  }
}

function switchAdminSubtab(subtab){
  document.querySelectorAll('.subtab-btn').forEach(b=> b.classList.toggle('active', b.dataset.subtab===subtab));
  document.querySelectorAll('.admin-subpanel').forEach(p=> p.classList.remove('active'));
  document.getElementById('adminsub-'+subtab).classList.add('active');
  if(subtab==='setup') renderSeriesSetup();
  if(subtab==='match') renderMatchSetup();
}

/* Points the player-facing PLAYERS/fixtures at whichever series My XI
   currently has open (currentSeriesId, already resolved by loadMySquads()).
   Shared by init() and the auth-state-change handler so login/logout always
   leaves them in sync. */
async function loadCurrentSeriesData(){
  if(currentSeriesId){
    await Promise.all([loadPlayers(currentSeriesId), loadFixtures(currentSeriesId), loadSeriesPlayerTotals(currentSeriesId)]);
  } else {
    PLAYERS = []; PLAYER_MAP = {}; fixtures = []; seriesPlayerTotals = {};
  }
}

