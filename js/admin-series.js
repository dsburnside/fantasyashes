/* js/admin-series.js — Admin tab: series/teams/fixtures/players setup. */
/* ================= ADMIN: shared "which series am I editing" picker =================
   Fixtures/Match Setup/Player Setup all edit one series at a time (adminSeriesId),
   independent of whichever league/series the admin themself happens to be
   playing in (currentLeagueId) — this picker is how they choose which. */
function adminSeriesPickerHtml(){
  if(seriesList.length===0){
    return `<div class="notice">No series yet — create one under Admin &rarr; Series first.</div>`;
  }
  return `
    <div class="card" style="margin-bottom:16px;">
      <label class="field-label">Series being managed</label>
      <select class="pick" id="adminSeriesSelect" style="max-width:320px;">
        ${seriesList.map(s=>`<option value="${s.id}" ${s.id===adminSeriesId?'selected':''}>${s.name}</option>`).join('')}
      </select>
    </div>`;
}
/* Scoped to a container (not document.getElementById) because Fixtures/Match
   Setup/Player Setup can all be in the DOM at once (renderAll() renders every
   admin subpanel, not just the visible one) and each has its own picker with
   this same id — an unscoped lookup would silently grab the wrong one. */
function wireAdminSeriesPicker(container, onChange){
  const sel = container.querySelector('#adminSeriesSelect');
  if(sel) sel.addEventListener('change', ()=>{ adminSeriesId = sel.value; onChange(); });
}

/* ================= ADMIN: SERIES SETUP (series, teams, fixtures & players — one interface) ================= */
let seriesSetupView = 'teams'; // 'teams' | 'fixtures' | 'players' — which light box shows below the series summary; persists across series switches, like the standings card does for My Leagues
/* Every branch below builds an HTML string (bodyHtml) and, where it needs
   click handlers, a postWire() closure — nothing touches the DOM until the
   single c.innerHTML write at the very end, once every await has resolved.
   Writing c.innerHTML immediately (with the real content filled in only
   after a later await) is what used to make editing/adding/removing a
   player — or switching any tab here — visibly "jump to the top of the
   page" on mobile: the panel would collapse to whatever placeholder was left
   in the DOM while the fetch was in flight, and however far down the page
   you'd scrolled, mobile browsers clamp scroll position to fit the now much
   shorter content — a clamp that doesn't undo itself once the real content
   reappears a moment later. Fetching first and writing once (the same
   pattern renderMatchSetup() in admin-match.js already used) avoids that gap
   entirely: old content stays on screen, unchanged, right up until it's
   replaced by the finished new content in one shot. renderLeaderboard() in
   leagues.js had the same bug for the same reason and got the same fix. */
async function renderSeriesSetup(){
  const c = document.getElementById('seriesSetupContent');
  if(!c) return;
  if(!supabaseClient){ c.innerHTML = `<div class="empty-state">Configure Supabase first.</div>`; return; }
  if(!isAdmin){ c.innerHTML = `<div class="empty-state"><div class="big">Admins only</div></div>`; return; }

  if(!adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  const currentSeries = seriesList.find(s=>s.id===adminSeriesId);

  let bodyHtml;
  let postWire = ()=>{};

  if(!currentSeries){
    bodyHtml = `<div class="empty-state"><div class="big">No series yet</div>Tap the + above to create one.</div>`;
  } else {
    adminPlayers = await fetchPlayers(adminSeriesId);
    adminPlayerMap = Object.fromEntries(adminPlayers.map(p=>[p.id,p]));
    adminFixtures = await fetchFixtures(adminSeriesId);
    adminSeriesTeams = resolveSeriesTeams(adminSeriesId, adminPlayers);
    const hasBothTeams = !!(currentSeries.teamA && currentSeries.teamB);
    if(seriesSetupView==='players' && !hasBothTeams) seriesSetupView = 'teams'; // players view needs teams first

    let subviewHtml = '';
    let wireSubview = ()=>{};

    /* ---- Configure teams ---- */
    if(seriesSetupView==='teams'){
      subviewHtml = `
        <div class="card">
          <div class="flex-between">
            <h3 style="margin:0; font-family:var(--font-display);">Teams</h3>
            <button class="btn secondary small" id="editTeamsBtn">Edit teams</button>
          </div>
          <p class="panel-sub" style="margin:8px 0 0;">
            ${hasBothTeams
              ? `<strong>${currentSeries.teamA.name}</strong> (${currentSeries.teamA.short_code}) vs <strong>${currentSeries.teamB.name}</strong> (${currentSeries.teamB.short_code})`
              : 'Not set yet — pick the two teams this series is contested between before adding fixtures or players.'}
          </p>
        </div>
      `;
      wireSubview = ()=>{
        document.getElementById('editTeamsBtn').addEventListener('click', ()=> openTeamsFormOverlay(currentSeries));
      };
    }

    /* ---- Fixtures ---- */
    if(seriesSetupView==='fixtures'){
      subviewHtml = `
        <div class="card">
          <div class="flex-between">
            <h3 style="margin:0; font-family:var(--font-display);">Fixtures</h3>
            <button class="btn secondary small" id="addFixtureBtn">+ Add fixture</button>
          </div>
          ${adminFixtures.length===0 ? '<div class="empty-state" style="margin-top:10px;">No fixtures yet.</div>' :
            adminFixtures.slice().sort((a,b)=>a.test-b.test).map(f=>`
            <div class="player-row" data-test="${f.test}" style="margin-top:10px;">
              <div class="player-name-wrap">
                <span class="player-name">Test ${f.test} — ${f.venue}</span>
                <span class="role-pill">${f.date}</span>
              </div>
              <div class="player-row-actions" style="align-items:center; gap:10px;">
                <span class="muted-on-light" style="font-size:11px;">locks ${new Date(f.deadline).toLocaleString()}</span>
                <button type="button" class="row-icon-btn primary" data-action="editFixture" data-test="${f.test}" title="Edit fixture" aria-label="Edit fixture">&#9998;</button>
                <button type="button" class="row-icon-btn danger" data-action="removeFixture" data-test="${f.test}" title="Delete fixture" aria-label="Delete fixture">&times;</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      wireSubview = (subwrap)=>{
        document.getElementById('addFixtureBtn').addEventListener('click', ()=> openFixtureFormOverlay(null));
        subwrap.querySelectorAll('[data-action="editFixture"]').forEach(btn=>{
          btn.addEventListener('click', ()=> openFixtureFormOverlay(adminFixtures.find(f=>String(f.test)===btn.dataset.test)));
        });
        subwrap.querySelectorAll('[data-action="removeFixture"]').forEach(btn=>{
          btn.addEventListener('click', async ()=>{
            const test = parseInt(btn.dataset.test);
            if(!(await showConfirm(`Remove Test ${test} from this series? Any match stats already entered for it go too.`, 'Remove fixture'))) return;
            const {error} = await supabaseClient.from('fixtures').delete().eq('series_id', adminSeriesId).eq('test', test);
            if(error){ showAlert(error.message); return; }
            if(adminSeriesId === currentSeriesId){ await loadFixtures(adminSeriesId); renderCountdown(); }
            renderSeriesSetup();
          });
        });
      };
    }

    /* ---- Players ---- */
    if(seriesSetupView==='players' && hasBothTeams){
      if(!playersPoolTeam || !adminSeriesTeams.some(t=>t.short_code===playersPoolTeam)) playersPoolTeam = adminSeriesTeams[0].short_code;
      const rowHtml = (p)=>{
        if(editingPlayerId === p.id){
          return `
            <div class="player-row added" data-pid="${p.id}">
              <div class="player-edit-fields">
                <input type="text" id="editName" value="${p.name}">
                <select id="editNat" class="pick">
                  ${adminSeriesTeams.map(t=>`<option value="${t.short_code}" ${p.nat===t.short_code?'selected':''}>${t.short_code}</option>`).join('')}
                </select>
                <select id="editRole" class="pick">
                  ${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
                </select>
              </div>
              <div class="player-row-actions">
                <button class="row-icon-btn primary" data-action="saveEdit" data-pid="${p.id}" title="Save" aria-label="Save">&#10003;</button>
                <button class="row-icon-btn" data-action="cancelEdit" title="Cancel" aria-label="Cancel">&times;</button>
              </div>
            </div>`;
        }
        return `
          <div class="player-row" data-pid="${p.id}">
            <div class="player-name-wrap">
              <span class="player-name">${p.name}</span>
              <span class="role-pill">${ROLE_LABEL[p.role]}</span>
            </div>
            <div class="player-row-actions">
              <button class="row-icon-btn primary" data-action="edit" data-pid="${p.id}" ${session?'':'disabled'} title="Edit player" aria-label="Edit player">&#9998;</button>
              <button class="row-icon-btn danger" data-action="remove" data-pid="${p.id}" ${session?'':'disabled'} title="Remove player" aria-label="Remove player">&times;</button>
            </div>
          </div>`;
      };

      // All pools render at once (each its own .admin-subpanel) so switching
      // the ENG/AUS tab is a plain local class-toggle, same as every other tab
      // bar in the app — not a full renderSeriesSetup() re-fetch/re-render.
      subviewHtml = `
        <div class="card">
          <div class="flex-between">
            <h3 style="margin:0; font-family:var(--font-display);">Players <button type="button" class="help-icon" id="playersHelpBtn" title="What's this?" aria-label="Help">?</button></h3>
            ${session ? '<button type="button" class="innings-add-btn" id="addPlayerOpenBtn" title="Add a player">+</button>' : ''}
          </div>
          <div class="admin-subnav light-subnav even-tabs" style="margin-top:12px;">
            ${adminSeriesTeams.map(t=>`<button class="subtab-btn${t.short_code===playersPoolTeam?' active':''}" data-poolteam="${t.short_code}">${t.short_code}</button>`).join('')}
          </div>
          ${adminSeriesTeams.map(t=>{
            const teamPlayers = adminPlayers.filter(p=>p.nat===t.short_code);
            return `
            <div class="admin-subpanel${t.short_code===playersPoolTeam?' active':''}" data-poolpanel="${t.short_code}" style="margin-top:12px;">
              ${teamPlayers.length ? teamPlayers.map(rowHtml).join('') : `<p class="muted">No ${t.name} players yet.</p>`}
            </div>`;
          }).join('')}
        </div>
      `;
      wireSubview = (subwrap)=>{
        document.getElementById('playersHelpBtn').addEventListener('click', ()=> showAlert('Add, edit or remove players from the pool that My Squads and Match Setup draw from for this series. Changes are shared with every league on this series. Removing a player already picked in someone\'s squad won\'t delete their squad — it just shows as "(removed player)" there, so remove sparingly once the series is underway.', 'Players'));
        subwrap.querySelectorAll('[data-poolteam]').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            playersPoolTeam = btn.dataset.poolteam;
            subwrap.querySelectorAll('[data-poolteam]').forEach(b=> b.classList.toggle('active', b===btn));
            subwrap.querySelectorAll('[data-poolpanel]').forEach(p=> p.classList.toggle('active', p.dataset.poolpanel===btn.dataset.poolteam));
          });
        });

        if(session){
          const addOpenBtn = document.getElementById('addPlayerOpenBtn');
          if(addOpenBtn) addOpenBtn.addEventListener('click', openAddPlayerOverlay);

          subwrap.querySelectorAll('[data-action="edit"]').forEach(btn=>{
            btn.addEventListener('click', ()=>{ editingPlayerId = btn.dataset.pid; renderSeriesSetup(); });
          });
          subwrap.querySelectorAll('[data-action="cancelEdit"]').forEach(btn=>{
            btn.addEventListener('click', ()=>{ editingPlayerId = null; renderSeriesSetup(); });
          });
          subwrap.querySelectorAll('[data-action="saveEdit"]').forEach(btn=>{
            btn.addEventListener('click', async ()=>{
              const pid = btn.dataset.pid;
              const name = document.getElementById('editName').value.trim();
              const nat = document.getElementById('editNat').value;
              const role = document.getElementById('editRole').value;
              const {error} = await supabaseClient.from('players').update({name, nat, role}).eq('series_id', adminSeriesId).eq('id', pid);
              if(error){ showAlert(error.message); return; }
              editingPlayerId = null;
              if(adminSeriesId === currentSeriesId) await loadPlayers(adminSeriesId);
              renderSeriesSetup();
            });
          });
          subwrap.querySelectorAll('[data-action="remove"]').forEach(btn=>{
            btn.addEventListener('click', async ()=>{
              const pid = btn.dataset.pid;
              const p = adminPlayerMap[pid];
              if(!(await showConfirm(`Remove ${p ? p.name : pid} from the pool?`, 'Remove player'))) return;
              const {error} = await supabaseClient.from('players').delete().eq('series_id', adminSeriesId).eq('id', pid);
              if(error){ showAlert(error.message); return; }
              if(adminSeriesId === currentSeriesId) await loadPlayers(adminSeriesId);
              renderSeriesSetup();
            });
          });
        }
      };
    }

    bodyHtml = `
      <div class="card">
        <div class="flex-between" style="margin-bottom:4px;">
          <h3 style="margin:0; font-family:var(--font-display);">${currentSeries.name}</h3>
          <span class="role-pill">${hasBothTeams ? `${currentSeries.teamA.short_code} vs ${currentSeries.teamB.short_code}` : 'teams not set'}</span>
        </div>
        <div class="admin-subnav light-subnav even-tabs" style="margin:12px 0 0;">
          <button class="subtab-btn${seriesSetupView==='teams'?' active':''}" data-view="teams">Teams</button>
          <button class="subtab-btn${seriesSetupView==='fixtures'?' active':''}" data-view="fixtures">Fixtures${adminFixtures.length?` (${adminFixtures.length})`:''}</button>
          <button class="subtab-btn${seriesSetupView==='players'?' active':''}" data-view="players" ${hasBothTeams?'':'disabled'} title="${hasBothTeams?'':'Configure first'}">Players${adminPlayers.length?` (${adminPlayers.length})`:''}</button>
        </div>
        <div class="save-bar" style="margin-top:16px; justify-content:flex-end;">
          <button class="btn secondary small" id="renameSeriesBtn">Rename</button>
          <button class="btn small danger" id="deleteSeriesBtn">Delete series</button>
        </div>
      </div>
      <div id="seriesSubviewWrap" style="margin-top:16px;">${subviewHtml}</div>
    `;
    postWire = ()=>{
      const body = document.getElementById('seriesSetupBody');
      body.querySelectorAll('[data-view]').forEach(btn=>{
        btn.addEventListener('click', ()=>{ seriesSetupView = btn.dataset.view; renderSeriesSetup(); });
      });
      document.getElementById('renameSeriesBtn').addEventListener('click', ()=> openRenameSeriesOverlay(currentSeries));
      document.getElementById('deleteSeriesBtn').addEventListener('click', ()=> deleteSeries(currentSeries));
      wireSubview(document.getElementById('seriesSubviewWrap'));
    };
  }

  c.innerHTML = `
    <h2 class="panel-title">Series Setup <button type="button" class="help-icon" id="seriesSetupHelpBtn" title="What's this?" aria-label="Help">?</button></h2>
    <div class="admin-subnav league-tabs" id="seriesTabs">
      ${seriesList.map(s=>`<button class="subtab-btn${s.id===adminSeriesId?' active':''}" data-sid="${s.id}">${s.name}</button>`).join('')}
      <button type="button" class="tab-add-btn" id="seriesAddBtn" title="Create a series">+</button>
    </div>
    <div id="seriesSetupBody">${bodyHtml}</div>
  `;
  document.getElementById('seriesSetupHelpBtn').addEventListener('click', ()=> showAlert('A series is one real-world tour — its own teams, player pool, fixtures and match stats. Leagues (a separate tab) group friends competing within a series, and can share it with other leagues.', 'Series Setup'));
  c.querySelectorAll('#seriesTabs [data-sid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ adminSeriesId = btn.dataset.sid; renderSeriesSetup(); });
  });
  document.getElementById('seriesAddBtn').addEventListener('click', openSeriesAddOverlay);
  postWire();
}

/* Add/edit a fixture — Test number, venue, match date and squad-lock
   deadline for one Test in adminSeriesId. fixture is null when adding (Test
   number editable, defaulting to the next unused one) or an adminFixtures
   entry when editing. Test number is locked while editing: it's half of the
   fixtures table's primary key (series_id, test) alongside series_id, so
   "changing" it is really deleting one row and inserting another — simplest
   to just not offer that here. Venue is free text against the shared venues
   table (see venuesList/loadVenuesList in data.js) rather than a foreign
   key, so a name that isn't in there yet gets added to it on save, ready to
   autocomplete from next time. */
function openFixtureFormOverlay(fixture){
  const isEdit = !!fixture;
  const nextTest = isEdit ? fixture.test : (adminFixtures.reduce((max,f)=>Math.max(max,f.test), 0) + 1);
  const backdrop = openOverlay(`
    <div class="overlay-title">${isEdit ? `Edit Test ${fixture.test}` : 'Add fixture'}</div>
    <div class="field-group">
      <label for="fxTest">Test number</label>
      <input type="number" id="fxTest" min="1" step="1" value="${nextTest}" ${isEdit ? 'disabled' : ''}>
    </div>
    <div class="field-group">
      <label for="fxVenue">Venue</label>
      <input type="text" id="fxVenue" list="fxVenueOptions" placeholder="e.g. Lord's" value="${isEdit ? fixture.venue : ''}">
      <datalist id="fxVenueOptions">${venuesList.map(v=>`<option value="${v.name}">`).join('')}</datalist>
    </div>
    <div class="field-group">
      <label for="fxDate">Match date</label>
      <input type="date" id="fxDate" value="${isEdit ? fixture.date : ''}">
    </div>
    <div class="field-group">
      <label for="fxDeadline">Squad lock deadline</label>
      <input type="datetime-local" id="fxDeadline" value="${isEdit ? fixture.deadline : ''}">
    </div>
    <div class="auth-error" id="fxError"></div>
    <div class="overlay-actions"><button class="btn" id="fxSaveBtn">${isEdit ? 'Save changes' : 'Add fixture'}</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });

  const saveBtn = backdrop.querySelector('#fxSaveBtn');
  const errBox = backdrop.querySelector('#fxError');
  saveBtn.addEventListener('click', async ()=>{
    const test = parseInt(backdrop.querySelector('#fxTest').value, 10);
    const venue = backdrop.querySelector('#fxVenue').value.trim();
    const date = backdrop.querySelector('#fxDate').value;
    const deadlineLocal = backdrop.querySelector('#fxDeadline').value;
    if(!test || test<1){ errBox.textContent = 'Enter a valid Test number.'; return; }
    if(!venue){ errBox.textContent = 'Enter a venue.'; return; }
    if(!date){ errBox.textContent = 'Enter the match date.'; return; }
    if(!deadlineLocal){ errBox.textContent = 'Enter a squad lock deadline.'; return; }
    if(!isEdit && adminFixtures.some(f=>f.test===test)){ errBox.textContent = `Test ${test} already exists in this series.`; return; }
    saveBtn.disabled = true;
    // Fixtures come back from Supabase through toDatetimeLocalValue() (state.js),
    // which formats the deadline in UTC (.toISOString().slice(0,16)) rather than
    // the browser's own time zone — appending :00.000Z here keeps writes
    // symmetric with that read, instead of reinterpreting the same digits as
    // local time and quietly shifting the deadline by a time zone offset.
    const deadline = deadlineLocal + ':00.000Z';
    const {error} = await supabaseClient.from('fixtures').upsert({series_id: adminSeriesId, test, venue, date, deadline});
    if(error){ saveBtn.disabled = false; errBox.textContent = error.message; return; }
    if(!venuesList.some(v=>v.name.toLowerCase()===venue.toLowerCase())){
      const {error: venueErr} = await supabaseClient.from('venues').insert({name: venue});
      if(!venueErr) await loadVenuesList(); // non-fatal if this fails — the fixture itself already saved
    }
    if(adminSeriesId === currentSeriesId){ await loadFixtures(adminSeriesId); renderCountdown(); }
    closeOverlay();
    renderSeriesSetup();
  });
}

/* Add-a-player modal, reached from the "+" next to the Players heading —
   defaults the Team field to whichever pool tab is currently showing. */
function openAddPlayerOverlay(){
  const backdrop = openOverlay(`
    <div class="overlay-title">Add a player</div>
    <div class="field-group"><label for="newPlayerNameOv">Name</label><input type="text" id="newPlayerNameOv" placeholder="e.g. Sam Konstas"></div>
    <div class="field-group">
      <label for="newPlayerNatOv">Team</label>
      <select id="newPlayerNatOv" class="pick">${adminSeriesTeams.map(t=>`<option value="${t.short_code}" ${t.short_code===playersPoolTeam?'selected':''}>${t.name}</option>`).join('')}</select>
    </div>
    <div class="field-group">
      <label for="newPlayerRoleOv">Role</label>
      <select id="newPlayerRoleOv" class="pick">${Object.keys(ROLE_LABEL).map(r=>`<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select>
    </div>
    <div class="auth-error" id="addPlayerError"></div>
    <div class="overlay-actions"><button class="btn" id="addPlayerBtnOv">Add player</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  const addBtn = backdrop.querySelector('#addPlayerBtnOv');
  const errBox = backdrop.querySelector('#addPlayerError');
  addBtn.addEventListener('click', async ()=>{
    const name = backdrop.querySelector('#newPlayerNameOv').value.trim();
    const nat = backdrop.querySelector('#newPlayerNatOv').value;
    const role = backdrop.querySelector('#newPlayerRoleOv').value;
    if(!name){ errBox.textContent = 'Enter a player name.'; return; }
    addBtn.disabled = true;
    const id = slugify(name, nat, adminPlayers);
    const {error} = await supabaseClient.from('players').insert({id, name, nat, role, series_id: adminSeriesId});
    if(error){ addBtn.disabled = false; errBox.textContent = error.message; return; }
    if(adminSeriesId === currentSeriesId) await loadPlayers(adminSeriesId);
    playersPoolTeam = nat; // land back on whichever pool they just added to
    closeOverlay();
    renderSeriesSetup();
  });
}

/* Create-series modal, reached from the "+" at the end of the series tabs. */
function openSeriesAddOverlay(){
  const backdrop = openOverlay(`
    <div class="overlay-title">Create a series</div>
    <div class="field-group"><label for="newSeriesNameOv">Name</label><input type="text" id="newSeriesNameOv" placeholder="e.g. India tour of Australia 2027"></div>
    <div class="auth-error" id="newSeriesError"></div>
    <div class="overlay-actions"><button class="btn" id="createSeriesBtnOv">Create series</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelector('#createSeriesBtnOv').addEventListener('click', async ()=>{
    const name = backdrop.querySelector('#newSeriesNameOv').value.trim();
    const errBox = backdrop.querySelector('#newSeriesError');
    if(!name){ errBox.textContent = 'Enter a series name.'; return; }
    const {data, error} = await supabaseClient.from('series').insert({name}).select().single();
    if(error){ errBox.textContent = error.message; return; }
    await loadSeriesList();
    adminSeriesId = data.id;
    seriesSetupView = 'teams';
    closeOverlay();
    renderSeriesSetup();
  });
}
function openRenameSeriesOverlay(s){
  const backdrop = openOverlay(`
    <div class="overlay-title">Rename series</div>
    <div class="field-group"><label for="renameSeriesInput">Name</label><input type="text" id="renameSeriesInput" value="${s.name}"></div>
    <div class="overlay-actions"><button class="btn" data-overlay-ok>Save</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelector('[data-overlay-ok]').addEventListener('click', async ()=>{
    const newName = document.getElementById('renameSeriesInput').value.trim();
    if(!newName) return;
    const {error} = await supabaseClient.from('series').update({name:newName}).eq('id', s.id);
    closeOverlay();
    if(error){ showAlert(error.message); return; }
    await loadSeriesList();
    renderSeriesSetup();
  });
}
async function deleteSeries(s){
  if(!(await showConfirm(`Delete "${s.name}" and every league, player, fixture and stat under it? This cannot be undone.`, 'Delete series'))) return;
  const {error} = await supabaseClient.from('series').delete().eq('id', s.id);
  if(error){ showAlert(error.message); return; }
  adminSeriesId = null;
  await loadSeriesList();
  if(!adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  renderSeriesSetup();
}

/* League creation/management moved to the My Leagues tab (self-service —
   see leagueTabsHtml()/openLeagueAddOverlay()) since it no longer needs an
   admin. editingPlayerId/playersPoolTeam below are used by the Players
   section inside renderSeriesSetup() above. */
let editingPlayerId = null;
let playersPoolTeam = null; // which team's pool tab is showing — short_code, re-defaulted to the first team whenever it's stale (switched series, etc.)

