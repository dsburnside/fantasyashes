/* js/admin-series.js — Admin Hub: series pill, and the Teams/Players/Fixtures side of the drill-down (see js/admin-match.js for the Fixtures > Match Setup > Player Selection/Scoring side). */
/* ================= ADMIN HUB: shared "which series am I editing" pill =================
   Every screen below edits one series at a time (adminSeriesId), independent
   of whichever league/series the admin themself happens to be playing in
   (currentSeriesId). Lives once, in the Admin Hub's own header (index.html's
   #adminSeriesPillWrap, above the whole drill-down) rather than a separate
   copy per screen — renderAdminSeriesPill() is what renderAdminHub() calls
   on every render to keep it in sync. */
function renderAdminSeriesPill(){
  const wrap = document.getElementById('adminSeriesPillWrap');
  if(!wrap) return;
  if(seriesList.length===0){
    wrap.innerHTML = `<button type="button" class="btn secondary small" id="adminSeriesFirstAddBtn">+ Create a series</button>`;
    document.getElementById('adminSeriesFirstAddBtn').addEventListener('click', ()=> openSeriesAddOverlay(renderAdminHub));
    return;
  }
  const current = seriesList.find(s=>s.id===adminSeriesId);
  wrap.innerHTML = switcherPillHtml('adminSeriesPillBtn', current ? current.name : 'Pick a series', "Switch which series you're managing");
  document.getElementById('adminSeriesPillBtn').addEventListener('click', ()=> openAdminSeriesSwitchOverlay(renderAdminHub));
}

/* Admin's own series-switcher lightbox, behind the pill above — unlike the
   generic switcher (openSwitcherOverlay, js/overlays.js) every other pill in
   the app uses, each row here also carries little rename/delete controls
   (same row-icon-btn ✎/× pattern as the fixture/player rows elsewhere in
   this file), since Admin is the only place a series' own name or existence
   is something you'd change from this list rather than just switch away
   from. That means each row's own click has to share space with those two
   buttons instead of being one big button itself (a button nested inside a
   button isn't reliably clickable), so this builds its rows by hand rather
   than going through openSwitcherOverlay's. */
function openAdminSeriesSwitchOverlay(onChange){
  const backdrop = openOverlay(`
    <div class="overlay-title">Switch series</div>
    <div class="picker-list">
      ${seriesList.map(s=>`
        <div class="player-row" data-sid="${s.id}" style="${s.id===adminSeriesId?'':'cursor:pointer;'}">
          <div class="player-name-wrap">
            <span class="player-name">${s.name}</span>
            ${s.id===adminSeriesId ? '<span class="nat-pill">Current</span>' : ''}
          </div>
          <div class="player-row-actions">
            <button type="button" class="row-icon-btn primary" data-action="renameSeries" data-sid="${s.id}" title="Rename series" aria-label="Rename series">&#9998;</button>
            <button type="button" class="row-icon-btn danger" data-action="deleteSeries" data-sid="${s.id}" title="Delete series" aria-label="Delete series">&times;</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="overlay-actions" style="margin-top:14px;">
      <button type="button" class="btn secondary" id="adminSeriesSwitchAddBtn" style="width:100%;">Create a new series</button>
    </div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelectorAll('.player-row[data-sid]').forEach(row=>{
    row.addEventListener('click', e=>{
      if(e.target.closest('[data-action]')) return; // rename/delete handle their own click below
      if(row.dataset.sid===adminSeriesId) return; // already viewing it
      closeOverlay();
      adminSeriesId = row.dataset.sid;
      adminScreen = 'top'; // land back at the top rather than a screen that belonged to the old series
      onChange();
    });
  });
  backdrop.querySelectorAll('[data-action="renameSeries"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const s = seriesList.find(x=>x.id===btn.dataset.sid);
      closeOverlay();
      openRenameSeriesOverlay(s, onChange);
    });
  });
  backdrop.querySelectorAll('[data-action="deleteSeries"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const s = seriesList.find(x=>x.id===btn.dataset.sid);
      closeOverlay();
      deleteSeries(s, onChange);
    });
  });
  const addBtn = backdrop.querySelector('#adminSeriesSwitchAddBtn');
  if(addBtn) addBtn.addEventListener('click', ()=>{ closeOverlay(); openSeriesAddOverlay(onChange); });
}

/* ================= ADMIN HUB: drill-down navigation =================
   Replaces what used to be two permanently-visible tab bars (Series Setup's
   own Teams/Fixtures/Players tabs, and a separate Match Setup tab with a
   Test <select>) with one 2-card-grid-and-a-back-button hierarchy:
     top -> Teams -> Players
     top -> Fixtures -> (pick a Test) -> Match -> Player Selection
                                                -> Scoring
   adminScreen is which of those is currently showing; adminMatchTest is
   which fixture/Test the Match/Player Selection/Scoring screens are for
   (set once, on drilling into a fixture — see goToAdminMatch, js/admin-match.js). */
let adminScreen = 'top'; // 'top' | 'teams' | 'players' | 'fixtures' | 'match' | 'xi' | 'scoring'
let adminMatchTest = null;

/* One nav tile — same shape used for the top-level Teams/Fixtures pair and
   the nested Player Selection/Scoring pair, so both read as the same
   interaction language even though they sit at different depths. */
function adminHubCardHtml(goto, title, sub){
  return `
    <button type="button" class="admin-hub-card" data-goto="${goto}">
      <span class="admin-hub-card-title">${title}</span>
      <span class="admin-hub-card-sub">${sub}</span>
    </button>`;
}
function adminHubGridHtml(cards){
  return `<div class="admin-hub-grid${cards.length===1?' single':''}">${cards.map(c=>adminHubCardHtml(c.goto,c.title,c.sub)).join('')}</div>`;
}
function adminBackBtnHtml(){
  return `<button type="button" class="btn secondary small" id="adminBackBtn">&larr; Back</button>`;
}

/* The one entry point for all of Admin now — fetches once (adminPlayers/
   adminFixtures/adminSeriesTeams, previously fetched separately by the old
   renderSeriesSetup()/renderMatchSetup()) and dispatches to whichever screen
   adminScreen currently points at. Every screen builder returns
   {html, wire(container)} — nothing touches the DOM until the single
   c.innerHTML write at the end, same reasoning as the old per-file version
   of this comment: writing immediately and filling in after a later await
   is what used to make switching screens jump to the top of the page on
   mobile. */
async function renderAdminHub(){
  const c = document.getElementById('adminHubContent');
  if(!c) return;
  if(!supabaseClient){ c.innerHTML = `<div class="empty-state">Configure Supabase first.</div>`; return; }
  if(!isAdmin){ c.innerHTML = `<div class="empty-state"><div class="big">Admins only</div></div>`; return; }
  renderAdminSeriesPill();

  if(!adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  const currentSeries = seriesList.find(s=>s.id===adminSeriesId);
  if(!currentSeries){
    c.innerHTML = `<div class="empty-state"><div class="big">No series selected</div>Pick or create one above.</div>`;
    return;
  }

  adminPlayers = await fetchPlayers(adminSeriesId);
  adminPlayerMap = Object.fromEntries(adminPlayers.map(p=>[p.id,p]));
  adminFixtures = await fetchFixtures(adminSeriesId);
  adminSeriesTeams = resolveSeriesTeams(adminSeriesId, adminPlayers);
  const hasBothTeams = !!(currentSeries.teamA && currentSeries.teamB);

  // Guard against a stale screen — switched series out from under Players
  // (needs teams first) or a Test that no longer has a fixture (deleted, or
  // just switched series) bounces back rather than rendering broken.
  if(adminScreen==='players' && !hasBothTeams) adminScreen = 'teams';
  if((adminScreen==='match'||adminScreen==='xi'||adminScreen==='scoring') && !adminFixtures.some(f=>f.test===adminMatchTest)) adminScreen = 'fixtures';

  let built;
  if(adminScreen==='teams') built = renderAdminTeamsScreen(currentSeries, hasBothTeams);
  else if(adminScreen==='players') built = renderAdminPlayersScreen();
  else if(adminScreen==='fixtures') built = renderAdminFixturesScreen();
  else if(adminScreen==='match') built = renderAdminMatchScreen();
  else if(adminScreen==='xi') built = renderAdminXiScreen();
  else if(adminScreen==='scoring') built = renderAdminScoringScreen();
  else built = renderAdminTopScreen(currentSeries, hasBothTeams);

  c.innerHTML = built.html;
  built.wire(c);
}

/* ---- top: [Teams] [Fixtures] ---- */
// No repeat-the-series-name heading here anymore — the pill right above
// (renderAdminSeriesPill, in the same header row as "Admin Hub") already
// names it, so this used to just say the same thing twice.
function renderAdminTopScreen(currentSeries, hasBothTeams){
  const html = `
    ${adminHubGridHtml([
      {goto:'teams', title:'Teams', sub: hasBothTeams ? `${currentSeries.teamA.short_code} vs ${currentSeries.teamB.short_code}` : 'Not set yet'},
      {goto:'fixtures', title:'Fixtures', sub: adminFixtures.length ? `${adminFixtures.length} Test${adminFixtures.length===1?'':'s'}` : 'None yet'},
    ])}
  `;
  const wire = c=>{
    c.querySelector('[data-goto="teams"]').addEventListener('click', ()=>{ adminScreen='teams'; renderAdminHub(); });
    c.querySelector('[data-goto="fixtures"]').addEventListener('click', ()=>{ adminScreen='fixtures'; renderAdminHub(); });
  };
  return {html, wire};
}

/* ---- Teams -> [Players] ---- */
function renderAdminTeamsScreen(currentSeries, hasBothTeams){
  const html = `
    ${adminBackBtnHtml()}
    <div class="card" style="margin-top:12px;">
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
    ${hasBothTeams ? adminHubGridHtml([{goto:'players', title:'Players', sub: `${adminPlayers.length} in the pool`}]) : ''}
  `;
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='top'; renderAdminHub(); });
    c.querySelector('#editTeamsBtn').addEventListener('click', ()=> openTeamsFormOverlay(currentSeries));
    const playersCard = c.querySelector('[data-goto="players"]');
    if(playersCard) playersCard.addEventListener('click', ()=>{ adminScreen='players'; renderAdminHub(); });
  };
  return {html, wire};
}

/* ---- Players (under Teams) ---- */
function renderAdminPlayersScreen(){
  if(!playersPoolTeam || !adminSeriesTeams.some(t=>t.short_code===playersPoolTeam)) playersPoolTeam = adminSeriesTeams[0].short_code;
  const rowHtml = p=>{
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

  // All pools render at once (each its own .admin-subpanel) so switching the
  // ENG/AUS tab is a plain local class-toggle, same as every other tab bar
  // in the app — not a full renderAdminHub() re-fetch/re-render.
  const html = `
    ${adminBackBtnHtml()}
    <div class="card" style="margin-top:12px;">
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
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='teams'; renderAdminHub(); });
    c.querySelector('#playersHelpBtn').addEventListener('click', ()=> showAlert('Add, edit or remove players from the pool that My Squads and Match Setup draw from for this series. Changes are shared with every league on this series. Removing a player already picked in someone\'s squad won\'t delete their squad — it just shows as "(removed player)" there, so remove sparingly once the series is underway.', 'Players'));
    c.querySelectorAll('[data-poolteam]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        playersPoolTeam = btn.dataset.poolteam;
        c.querySelectorAll('[data-poolteam]').forEach(b=> b.classList.toggle('active', b===btn));
        c.querySelectorAll('[data-poolpanel]').forEach(p=> p.classList.toggle('active', p.dataset.poolpanel===btn.dataset.poolteam));
      });
    });
    if(!session) return;
    const addOpenBtn = c.querySelector('#addPlayerOpenBtn');
    if(addOpenBtn) addOpenBtn.addEventListener('click', openAddPlayerOverlay);
    c.querySelectorAll('[data-action="edit"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ editingPlayerId = btn.dataset.pid; renderAdminHub(); });
    });
    c.querySelectorAll('[data-action="cancelEdit"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{ editingPlayerId = null; renderAdminHub(); });
    });
    c.querySelectorAll('[data-action="saveEdit"]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const pid = btn.dataset.pid;
        const name = document.getElementById('editName').value.trim();
        const nat = document.getElementById('editNat').value;
        const role = document.getElementById('editRole').value;
        const {error} = await supabaseClient.from('players').update({name, nat, role}).eq('series_id', adminSeriesId).eq('id', pid);
        if(error){ showAlert(error.message); return; }
        editingPlayerId = null;
        if(adminSeriesId === currentSeriesId) await loadPlayers(adminSeriesId);
        renderAdminHub();
      });
    });
    c.querySelectorAll('[data-action="remove"]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const pid = btn.dataset.pid;
        const p = adminPlayerMap[pid];
        if(!(await showConfirm(`Remove ${p ? p.name : pid} from the pool?`, 'Remove player'))) return;
        const {error} = await supabaseClient.from('players').delete().eq('series_id', adminSeriesId).eq('id', pid);
        if(error){ showAlert(error.message); return; }
        if(adminSeriesId === currentSeriesId) await loadPlayers(adminSeriesId);
        renderAdminHub();
      });
    });
  };
  return {html, wire};
}

/* ---- Fixtures -> (pick one) -> Match Setup (js/admin-match.js) ---- */
function renderAdminFixturesScreen(){
  const html = `
    ${adminBackBtnHtml()}
    <div class="card" style="margin-top:12px;">
      <div class="flex-between">
        <h3 style="margin:0; font-family:var(--font-display);">Fixtures</h3>
        <button class="btn secondary small" id="addFixtureBtn">+ Add fixture</button>
      </div>
      ${adminFixtures.length===0 ? '<div class="empty-state" style="margin-top:10px;">No fixtures yet.</div>' :
        `<p class="panel-sub" style="margin:8px 0 0;">Tap a Test to select its Playing XI and enter/lock scoring.</p>` +
        adminFixtures.slice().sort((a,b)=>a.test-b.test).map(f=>`
        <div class="player-row" data-test="${f.test}" style="margin-top:10px; cursor:pointer; flex-direction:column; align-items:stretch; gap:6px;">
          <div class="player-name-wrap">
            <span class="player-name">Test ${f.test} — ${f.venue}</span>
            <span class="role-pill">${f.date}</span>
            <span class="muted-on-light" style="margin-left:auto; font-size:11px;">locks ${new Date(f.deadline).toLocaleString()}</span>
          </div>
          <div class="player-row-actions" style="justify-content:flex-end;">
            <button type="button" class="row-icon-btn primary" data-action="editFixture" data-test="${f.test}" title="Edit fixture" aria-label="Edit fixture">&#9998;</button>
            <button type="button" class="row-icon-btn danger" data-action="removeFixture" data-test="${f.test}" title="Delete fixture" aria-label="Delete fixture">&times;</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='top'; renderAdminHub(); });
    c.querySelector('#addFixtureBtn').addEventListener('click', ()=> openFixtureFormOverlay(null));
    c.querySelectorAll('.player-row[data-test]').forEach(row=>{
      row.addEventListener('click', e=>{
        if(e.target.closest('[data-action]')) return; // edit/delete handle their own click below
        goToAdminMatch(parseInt(row.dataset.test));
      });
    });
    c.querySelectorAll('[data-action="editFixture"]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        openFixtureFormOverlay(adminFixtures.find(f=>String(f.test)===btn.dataset.test));
      });
    });
    c.querySelectorAll('[data-action="removeFixture"]').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.stopPropagation();
        const test = parseInt(btn.dataset.test);
        if(!(await showConfirm(`Remove Test ${test} from this series? Any match stats already entered for it go too.`, 'Remove fixture'))) return;
        const {error} = await supabaseClient.from('fixtures').delete().eq('series_id', adminSeriesId).eq('test', test);
        if(error){ showAlert(error.message); return; }
        if(adminSeriesId === currentSeriesId){ await loadFixtures(adminSeriesId); renderCountdown(); }
        renderAdminHub();
      });
    });
  };
  return {html, wire};
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
    renderAdminHub();
  });
}

/* Picks the two teams (from the shared teams master data, teamsList —
   js/data.js) this series is contested between. Was referenced from the
   Teams screen's "Edit teams" button without ever being written — a
   pre-existing gap, not something this drill-down rework introduced, just
   the first time this exact screen got touched since. */
function openTeamsFormOverlay(series){
  if(teamsList.length<2){
    showAlert('Fewer than two teams exist in the shared teams list yet — add another directly in the database (public.teams) before a series can be assigned two.', 'No teams to pick from');
    return;
  }
  const backdrop = openOverlay(`
    <div class="overlay-title">Edit teams</div>
    <div class="field-group">
      <label for="teamASelect">Team A</label>
      <select id="teamASelect" class="pick">${teamsList.map(t=>`<option value="${t.id}" ${series.teamA && series.teamA.id===t.id?'selected':''}>${t.name} (${t.short_code})</option>`).join('')}</select>
    </div>
    <div class="field-group">
      <label for="teamBSelect">Team B</label>
      <select id="teamBSelect" class="pick">${teamsList.map(t=>`<option value="${t.id}" ${series.teamB && series.teamB.id===t.id?'selected':''}>${t.name} (${t.short_code})</option>`).join('')}</select>
    </div>
    <div class="auth-error" id="teamsFormError"></div>
    <div class="overlay-actions"><button class="btn" id="teamsFormSaveBtn">Save</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  const errBox = backdrop.querySelector('#teamsFormError');
  backdrop.querySelector('#teamsFormSaveBtn').addEventListener('click', async ()=>{
    const teamAId = backdrop.querySelector('#teamASelect').value;
    const teamBId = backdrop.querySelector('#teamBSelect').value;
    if(teamAId===teamBId){ errBox.textContent = 'Pick two different teams.'; return; }
    const {error} = await supabaseClient.from('series').update({team_a_id: teamAId, team_b_id: teamBId}).eq('id', series.id);
    if(error){ errBox.textContent = error.message; return; }
    await loadSeriesList();
    closeOverlay();
    renderAdminHub();
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
    renderAdminHub();
  });
}

/* Create-series modal, reached from "Create a new series" in the Admin Hub's
   series-switcher lightbox (openAdminSeriesSwitchOverlay above), or straight
   off the pill itself when there's no series yet at all (renderAdminSeriesPill).
   onCreated: re-renders the whole hub once the new series exists — always
   renderAdminHub in practice now (both callers above pass it), kept as a
   param rather than hardcoded since this used to be reachable from two
   separately-rendered subpanels and there's no reason to reintroduce that
   coupling if this ever gets a second caller again. */
function openSeriesAddOverlay(onCreated){
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
    adminScreen = 'top';
    closeOverlay();
    (onCreated || renderAdminHub)();
  });
}
function openRenameSeriesOverlay(s, onChange){
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
    (onChange || renderAdminHub)();
  });
}
/* Requires the admin's own account password (showPasswordConfirm, same
   two-step are-you-sure-then-reauth pattern deleteLeagueBtn — js/leagues.js
   — uses) on top of the usual confirm, given how much a series deletion
   cascades (every league/player/fixture/stat under it, permanently). */
async function deleteSeries(s, onChange){
  if(!(await showConfirm(`Delete "${s.name}" and every league, player, fixture and stat under it? This cannot be undone.`, 'Delete series'))) return;
  if(!(await showPasswordConfirm('Enter your account password to finish deleting this series.', 'Confirm deletion'))) return;
  const {error} = await supabaseClient.from('series').delete().eq('id', s.id);
  if(error){ showAlert(error.message); return; }
  adminSeriesId = null;
  await loadSeriesList();
  if(!adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  adminScreen = 'top';
  (onChange || renderAdminHub)();
}

/* League creation/management moved to the My Leagues tab (self-service —
   see leagueTabsHtml()/openLeagueAddOverlay()) since it no longer needs an
   admin. editingPlayerId/playersPoolTeam below are used by the Players
   screen above. */
let editingPlayerId = null;
let playersPoolTeam = null; // which team's pool tab is showing — short_code, re-defaulted to the first team whenever it's stale (switched series, etc.)
