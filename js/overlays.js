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
    <div class="overlay-message">Pick a team for any series, no league required — one squad per series, per account. Leagues (create or join under My Leagues) are an optional way to compare against friends. You can browse Rules without an account; My XI and My Leagues need a login. Signing up needs your first and last name too, so other players can see who manages which team on the leaderboard.</div>
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
        <div class="picker-group-title">${ROLE_LABEL[g.role]}s</div>
        ${g.players.map(p=>{
          const selectable = isSelectable(p);
          const pts = totalsFor(p.id);
          return `
          <button type="button" class="picker-row" data-pid="${p.id}" ${selectable?'':`disabled title="Would leave ${teamNameForCode(poolNats.find(n=>n!==p.nat))} short of the 5-player minimum"`}>
            <span>${p.name} <span class="role-pill">${p.nat}</span></span>
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

