/* js/overlays.js — the modal/overlay engine (openOverlay/showAlert/showConfirm/showPasswordConfirm/openPlayerPicker/login+account overlays). */
/* ================= OVERLAY ENGINE (replaces alert / confirm / prompt) ================= */
function closeOverlay(){
  const existing = document.getElementById('appOverlay');
  if(existing) existing.remove();
  document.body.classList.remove('overlay-open');
}
function openOverlay(innerHtml, {dismissible=true}={}){
  closeOverlay();
  const backdrop = document.createElement('div');
  backdrop.className = 'overlay-backdrop';
  backdrop.id = 'appOverlay';
  backdrop.innerHTML = `<div class="overlay-box">${dismissible ? '<button type="button" class="overlay-close" data-overlay-close aria-label="Close">&times;</button>' : ''}${innerHtml}</div>`;
  document.body.appendChild(backdrop);
  // Lock the base page behind the overlay — on mobile, a touch-drag meant
  // for a form field would otherwise scroll the page underneath instead of
  // (or as well as) the overlay, making long forms like login/signup fiddly.
  document.body.classList.add('overlay-open');
  return backdrop;
}
function showAlert(message, title='Notice'){
  const backdrop = openOverlay(`
    <div class="overlay-title">${title}</div>
    <div class="overlay-message">${message}</div>
    <div class="overlay-actions"><button class="btn" data-overlay-ok>OK</button></div>
  `);
  const done = ()=> closeOverlay();
  backdrop.querySelector('[data-overlay-ok]').addEventListener('click', done);
  backdrop.querySelector('[data-overlay-close]')?.addEventListener('click', done);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) done(); });
}
function showConfirm(message, title='Please confirm'){
  return new Promise(resolve=>{
    const backdrop = openOverlay(`
      <div class="overlay-title">${title}</div>
      <div class="overlay-message">${message}</div>
      <div class="overlay-actions">
        <button class="btn secondary" data-overlay-cancel>Cancel</button>
        <button class="btn danger" data-overlay-confirm>Confirm</button>
      </div>
    `);
    const finish = (val)=>{ closeOverlay(); resolve(val); };
    backdrop.querySelector('[data-overlay-confirm]').addEventListener('click', ()=>finish(true));
    backdrop.querySelector('[data-overlay-cancel]').addEventListener('click', ()=>finish(false));
    backdrop.querySelector('[data-overlay-close]')?.addEventListener('click', ()=>finish(false));
    backdrop.addEventListener('click', e=>{ if(e.target===backdrop) finish(false); });
  });
}
/* Like showConfirm, but for actions destructive enough to re-check the
   signed-in user's identity rather than just their intent (currently: league
   deletion). There's no separate "verify my current password" endpoint in
   Supabase Auth, so this re-runs signInWithPassword against the session's own
   email — wrong password fails it the same way a login attempt would, right
   password just re-authenticates the same session (harmless). Resolves true
   only once that's succeeded; false on cancel/close. */
function showPasswordConfirm(message, title='Confirm with your password'){
  return new Promise(resolve=>{
    const backdrop = openOverlay(`
      <div class="overlay-title">${title}</div>
      <div class="overlay-message">${message}</div>
      <div class="field-group"><label for="pwConfirmInput">Account password</label><input type="password" id="pwConfirmInput" placeholder="Your password" autocomplete="current-password"></div>
      <div class="auth-error" id="pwConfirmError"></div>
      <div class="overlay-actions">
        <button class="btn secondary" data-overlay-cancel>Cancel</button>
        <button class="btn danger" id="pwConfirmBtn">Confirm</button>
      </div>
    `);
    const finish = (val)=>{ closeOverlay(); resolve(val); };
    const input = backdrop.querySelector('#pwConfirmInput');
    const errBox = backdrop.querySelector('#pwConfirmError');
    const confirmBtn = backdrop.querySelector('#pwConfirmBtn');
    const attempt = async ()=>{
      const password = input.value;
      if(!password){ errBox.textContent = 'Enter your password.'; return; }
      confirmBtn.disabled = true;
      const {error} = await supabaseClient.auth.signInWithPassword({email: session.user.email, password});
      confirmBtn.disabled = false;
      if(error){ errBox.textContent = 'Incorrect password.'; input.select(); return; }
      finish(true);
    };
    confirmBtn.addEventListener('click', attempt);
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') attempt(); });
    backdrop.querySelector('[data-overlay-cancel]').addEventListener('click', ()=>finish(false));
    backdrop.querySelector('[data-overlay-close]')?.addEventListener('click', ()=>finish(false));
    backdrop.addEventListener('click', e=>{ if(e.target===backdrop) finish(false); });
    input.focus();
  });
}
function showLoginOverlay(dismissible=true){
  const backdrop = openOverlay(`
    <span class="overlay-lock-icon">&#127978;</span>
    <div class="overlay-title">Sign in to The Ashes Fantasy XI</div>
    <div class="overlay-message">Pick a team for any series, no league required — one squad per series, per account. Leagues (create or join under My Leagues) are an optional way to compare against friends. You can browse Rules without an account; My Squads and My Leagues need a login. Signing up needs your first and last name too, so other players can see who manages which team on the leaderboard.</div>
    <div class="field-group"><label for="ovFirstName">First name</label><input type="text" id="ovFirstName" placeholder="Jane"></div>
    <div class="field-group"><label for="ovLastName">Last name</label><input type="text" id="ovLastName" placeholder="Doe"></div>
    <div class="field-group"><label for="ovEmail">Email</label><input type="email" id="ovEmail" placeholder="you@example.com"></div>
    <div class="field-group"><label for="ovPassword">Password</label><input type="password" id="ovPassword" placeholder="6+ characters"></div>
    <div class="auth-error" id="ovError"></div>
    <div class="overlay-actions" style="justify-content:space-between;">
      <button class="btn secondary" data-overlay-signup>Sign up</button>
      <button class="btn" data-overlay-login>Log in</button>
    </div>
  `, {dismissible});
  const errBox = backdrop.querySelector('#ovError');
  const run = async (mode)=>{
    errBox.textContent = '';
    const firstName = backdrop.querySelector('#ovFirstName').value.trim();
    const lastName = backdrop.querySelector('#ovLastName').value.trim();
    const email = backdrop.querySelector('#ovEmail').value.trim();
    const password = backdrop.querySelector('#ovPassword').value;
    if(!email || password.length < 6){
      errBox.textContent = 'Enter an email and a password of 6+ characters.';
      return;
    }
    if(mode === 'signup' && (!firstName || !lastName)){
      errBox.textContent = 'Enter your first and last name.';
      return;
    }
    const {error} = mode === 'signup'
      ? await supabaseClient.auth.signUp({email, password, options:{data:{first_name:firstName, last_name:lastName}}})
      : await supabaseClient.auth.signInWithPassword({email, password});
    if(error){ errBox.textContent = error.message; return; }
    closeOverlay();
    if(mode === 'signup'){
      showAlert('Account created. If email confirmation is on for this project, check your inbox before logging in.', 'Almost there');
    }
  };
  backdrop.querySelector('[data-overlay-login]').addEventListener('click', ()=> run('login'));
  backdrop.querySelector('[data-overlay-signup]').addEventListener('click', ()=> run('signup'));
  if(dismissible){
    backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
    backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  }
}

/* Lightbox listing every available player (not already in excludeIds) at
   once, grouped by base role — Batters, All-rounders, Wicketkeepers, Bowlers
   — and sorted within each group by total series points scored so far
   (highest first; 0 for anyone yet to play this series). Used for both
   adding a player into an empty slot and replacing an existing one.
   countBasisIds is the squad to count each team's tally from for the 5-per-
   team feasibility check below — the same as excludeIds for a straight add,
   but excludeIds minus the outgoing player for a replace (their slot isn't
   really "gone" until the swap completes, so it shouldn't count against
   itself). Defaults to excludeIds when not given. */
function openPlayerPicker(excludeIds, onPick, countBasisIds){
  const basis = countBasisIds || excludeIds;
  const backdrop = openOverlay(`
    <div class="overlay-title">Pick a player</div>
    <div id="pickerBody"></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });

  // How many more picks are left after this one (the squad tops out at 14),
  // and how many of each team are already locked in among `basis`.
  const poolNats = [...new Set(PLAYERS.map(p=>p.nat))];
  const baseCounts = {};
  basis.forEach(id=>{ const n = getPlayer(id).nat; baseCounts[n] = (baseCounts[n]||0) + 1; });
  const slotsAfterThisPick = 14 - basis.length - 1;
  // A candidate is selectable only if, after picking them, there's still
  // room left to bring every team up to its 5-player minimum — e.g. with 1
  // slot left and Australia still short 2, every England candidate greys out
  // since taking one would make 5 Australians impossible to reach.
  function isSelectable(p){
    const counts = {...baseCounts};
    counts[p.nat] = (counts[p.nat]||0) + 1;
    const stillNeeded = poolNats.reduce((sum,n)=> sum + Math.max(0, 5-(counts[n]||0)), 0);
    return stillNeeded <= slotsAfterThisPick;
  }

  const totalsFor = pid => seriesPlayerTotals[pid] || {bat:0, bowl:0, field:0, total:0};

  const avail = PLAYERS.filter(p=>!excludeIds.includes(p.id));
  const groups = ROLE_GROUP_ORDER.map(role=>({
    role,
    players: avail.filter(p=>p.role===role)
      .sort((a,b)=> totalsFor(b.id).total - totalsFor(a.id).total || a.name.localeCompare(b.name)),
  })).filter(g=>g.players.length);

  document.getElementById('pickerBody').innerHTML = `
    <div class="overlay-message">Sorted by total series points within each role. Greyed-out players would leave a team short of the 5-player minimum.</div>
    <div class="picker-list">
      ${groups.length ? groups.map(g=>`
        <div class="picker-group-title">${ROLE_LABEL[g.role]}</div>
        ${g.players.map(p=>{
          const selectable = isSelectable(p);
          const pts = totalsFor(p.id);
          return `
          <button type="button" class="picker-row" data-pid="${p.id}" ${selectable?'':`disabled title="Would leave ${teamNameForCode(poolNats.find(n=>n!==p.nat))} short of the 5-player minimum"`}>
            <span>${p.name} <span class="nat-pill">${p.nat}</span></span>
            <span class="picker-points">
              <span title="Batting points this series">Bat ${pts.bat}</span>
              <span title="Bowling points this series">Bowl ${pts.bowl}</span>
              <span title="Fielding points this series">Fld ${pts.field}</span>
            </span>
          </button>`;
        }).join('')}
      `).join('') : '<p class="auth-hint">No available players left.</p>'}
    </div>
  `;
  document.querySelectorAll('#pickerBody .picker-row').forEach(btn=>{
    if(btn.disabled) return;
    btn.addEventListener('click', ()=>{ closeOverlay(); onPick(btn.dataset.pid); });
  });
}

/* Player detail lightbox — reached by tapping a squad card in My XI (a plain
   tap; dragging still repositions/swaps zones — see the pointer handler in
   js/myxi.js). This is where playing role, captain/VC and replace all live
   now instead of as separate buttons crammed onto the card, plus this
   player's series-to-date stats (seriesPlayerTotals, js/data.js) — the card
   itself just shows read-only status icons for whatever's chosen here. */
function openPlayerDetailOverlay(pid, zone){
  // dismissible:false drops the usual corner × — Cancel/Confirm at the
  // bottom of the overlay body are the explicit way out now, so a second,
  // redundant close control up top isn't needed. Clicking the backdrop
  // outside the box still closes it either way.
  const backdrop = openOverlay(`
    <div class="overlay-title" id="pdTitle"></div>
    <div id="pdBody"></div>
  `, {dismissible: false});
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  renderPlayerDetailBody(pid, zone);
}
/* Separate from openPlayerDetailOverlay so role/captain/VC toggles below can
   redraw just this overlay's own content after each change (renderMyXI()
   keeps the actual My XI screen behind it in sync at the same time) instead
   of closing and reopening the whole overlay, which would replay its open
   animation on every tap. */
function renderPlayerDetailBody(pid, zone){
  const titleEl = document.getElementById('pdTitle');
  if(!titleEl) return; // overlay's already been closed (e.g. by the Replace button below)
  const p = getPlayer(pid);
  const totals = seriesPlayerTotals[pid] || {runs:0, wickets:0, catches:0, stumpings:0, runouts:0, total:0};
  const assignedRole = assignedPlayingRole(pid);
  const isCap = pid===draft.captain, isVc = pid===draft.viceCaptain;
  titleEl.textContent = p.name;
  document.getElementById('pdBody').innerHTML = `
    <div class="overlay-message" style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
      <span class="nat-pill">${p.nat}</span>
      <span style="color:var(--parchment-dim); font-size:12px;">Base role: ${ROLE_LABEL[p.role]}</span>
    </div>
    <table class="breakdown-table" style="margin-bottom:20px;">
      <tr><th>Runs</th><th>Wkts</th><th>Ct</th><th>St</th><th>RO</th><th>Pts</th></tr>
      <tr>
        <td>${totals.runs}</td><td>${totals.wickets}</td><td>${totals.catches}</td>
        <td>${totals.stumpings}</td><td>${totals.runouts}</td><td class="pts">${totals.total}</td>
      </tr>
    </table>
    <div class="field-group">
      <label>Playing role</label>
      <div class="pd-btn-row" style="margin-top:6px;">
        ${ROLE_GROUP_ORDER.filter(r=>r!=='AR').map(r=>`
          <button type="button" class="pd-btn${assignedRole===r?' active':''}" data-role="${r}" title="Playing role: ${ROLE_LABEL[r]}" aria-label="Playing role: ${ROLE_LABEL[r]}">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ROLE_ICON_PATH[r]}</svg>
          </button>
        `).join('')}
        ${zone==='xi' ? `
          <div class="pd-btn-row" style="margin-left:auto;">
            <button type="button" class="pd-btn${isCap?' cap-active':''}" id="pdCapBtn" title="${isCap?'Remove as captain':'Make captain'}" aria-label="${isCap?'Remove as captain':'Make captain'}">C</button>
            <button type="button" class="pd-btn${isVc?' vc-active':''}" id="pdVcBtn" title="${isVc?'Remove as vice-captain':'Make vice-captain'}" aria-label="${isVc?'Remove as vice-captain':'Make vice-captain'}">VC</button>
          </div>
        ` : ''}
      </div>
    </div>
    <button type="button" class="btn danger" id="pdReplaceBtn" style="width:100%; margin-top:18px;">Replace</button>
    <div class="overlay-actions" style="margin-top:14px;">
      <button type="button" class="btn secondary" id="pdCancelBtn" style="flex:1;">Cancel</button>
      <button type="button" class="btn" id="pdConfirmBtn" style="flex:1;">Confirm</button>
    </div>
  `;
  document.querySelectorAll('#pdBody .pd-btn[data-role]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      draft.playingRoles[pid] = btn.dataset.role;
      renderMyXI();
      renderPlayerDetailBody(pid, zone);
    });
  });
  const capBtn = document.getElementById('pdCapBtn');
  if(capBtn) capBtn.addEventListener('click', ()=>{
    draft.captain = isCap ? null : pid;
    if(draft.viceCaptain===draft.captain) draft.viceCaptain = null;
    renderMyXI();
    renderPlayerDetailBody(pid, zone);
  });
  const vcBtn = document.getElementById('pdVcBtn');
  if(vcBtn) vcBtn.addEventListener('click', ()=>{
    draft.viceCaptain = isVc ? null : pid;
    if(draft.captain===draft.viceCaptain) draft.captain = null;
    renderMyXI();
    renderPlayerDetailBody(pid, zone);
  });
  const replaceBtn = document.getElementById('pdReplaceBtn');
  if(replaceBtn) replaceBtn.addEventListener('click', ()=>{
    closeOverlay();
    replaceSquadPlayer(pid);
  });
  // Role/captain/VC above all apply the moment you tap them (same as every
  // other toggle in this app) rather than staging changes for these two to
  // commit or discard — so Cancel and Confirm both just close the overlay.
  // They're here anyway as an explicit, unambiguous "I'm done with this
  // player" action, rather than only the corner × / tapping outside.
  const cancelBtn = document.getElementById('pdCancelBtn');
  if(cancelBtn) cancelBtn.addEventListener('click', closeOverlay);
  const confirmBtn = document.getElementById('pdConfirmBtn');
  if(confirmBtn) confirmBtn.addEventListener('click', closeOverlay);
}

