/* js/admin-match.js — Admin Hub: Fixtures > Match Setup > Player Selection/Scoring (see js/admin-series.js for the Teams/Players/Fixtures-list side and the drill-down state itself, adminScreen/adminMatchTest). */
/* ================= MATCH CENTRE ================= */

/* ---- Match (a fixture's own hub) -> [Player Selection] [Scoring] ---- */
function renderAdminMatchScreen(){
  const fixture = adminFixtures.find(f=>f.test===adminMatchTest);
  const html = `
    ${adminBackBtnHtml()}
    <h3 style="margin:12px 0 14px; font-family:var(--font-display);">Test ${adminMatchTest}${fixture ? ' — '+fixture.venue : ''} <button type="button" class="help-icon" id="matchSetupHelpBtn" title="What's this?" aria-label="Help">?</button></h3>
    ${adminSeriesTeams.length<2 ? '<div class="empty-state">This series needs both teams assigned first — set them under Teams.</div>' : adminHubGridHtml([
      {goto:'xi', title:'Player Selection', sub: `${currentPlayingXiDraft.length} ticked`},
      {goto:'scoring', title:'Scoring', sub: currentInningsDraft.length ? `${currentInningsDraft.length} innings` : 'No innings yet'},
    ])}
    <div style="margin-top:22px; padding-top:14px; border-top:1px solid var(--parchment-dim);">
      <p class="muted-on-light" style="font-size:12px; margin:0 0 10px;">Wipes this Test back to how it started — every stat, the Playing XI, the innings, and its lock (including any wildcard it used up).</p>
      <div class="save-bar" style="margin-top:0;">
        <button class="btn danger" id="resetTestBtn">Reset this Test</button>
      </div>
    </div>
  `;
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='fixtures'; renderAdminHub(); });
    c.querySelector('#matchSetupHelpBtn').addEventListener('click', ()=> showAlert("Player Selection is who actually took the field — tick them once the real teams are announced. Scoring is where each innings' runs/wickets/catches etc. get entered, and where a Test gets locked in for every league's scoring once it's done.", 'Match Setup'));
    const xiCard = c.querySelector('[data-goto="xi"]');
    if(xiCard) xiCard.addEventListener('click', ()=>{ adminScreen='xi'; renderAdminHub(); });
    const scoringCard = c.querySelector('[data-goto="scoring"]');
    if(scoringCard) scoringCard.addEventListener('click', ()=>{ adminScreen='scoring'; renderAdminHub(); });
    c.querySelector('#resetTestBtn').addEventListener('click', ()=> resetTest(adminMatchTest));
  };
  return {html, wire};
}

/* Reached by tapping a fixture row on the Fixtures screen (js/admin-series.js)
   — loads that Test's draft (stats/Playing XI/innings) once, then drops into
   the Match screen above. Player Selection/Scoring below both just render
   from this same draft afterward (no re-fetch switching between them —
   they're plain screen navigation now, not a network round-trip each way). */
async function goToAdminMatch(testNum){
  const {stats, playingXi, innings} = await getMatchDataForTest(adminSeriesId, testNum);
  currentStatsDraft = JSON.parse(JSON.stringify(stats));
  currentPlayingXiDraft = [...playingXi];
  currentInningsDraft = innings.map(e=>({...e}));
  activeInningsIdx = 0;
  adminMatchTest = testNum;
  adminScreen = 'match';
  renderAdminHub();
}

let currentStatsDraft = {};
let currentPlayingXiDraft = [];
let currentInningsDraft = []; // [{battingCode, inn}] in the order they were added, max 4, max 2 per team
let activeInningsIdx = 0;
let adminSeriesTeams = []; // the two {id,name,short_code} teams for adminSeriesId — see resolveSeriesTeams()
let playingXiPoolTeam = null; // which team's XI tab is showing in renderPlayingXiTable — short_code, re-defaulted whenever stale
const STAT_COLUMN_GROUPS = {
  batting: [
    {key:'runs', label:'Runs', type:'number'},
    {key:'duck', label:'Duck', type:'checkbox'},
    {key:'fifty', label:'50', type:'checkbox'},
    {key:'hundred', label:'100', type:'checkbox'},
  ],
  bowling: [
    {key:'wickets', label:'Wkts', type:'number'},
    {key:'fourWkt', label:'4-fer', type:'checkbox'},
    {key:'fiveWkt', label:'5-fer', type:'checkbox'},
  ],
  fielding: [
    {key:'catches', label:'Ct', type:'number'},
    {key:'stumpings', label:'St', type:'number'},
    {key:'runouts', label:'RO', type:'number'},
  ],
};
// Player order within each stat table — role priority first (batting wants
// its best batters at the top regardless of nominal role, etc.), then
// alphabetical by name within a role. ROLE_GROUP_ORDER (state.js) already
// matches the requested batting order (Batter > All-rounder > Wicketkeeper >
// Bowler), so it's reused rather than redefined.
const CATEGORY_ROLE_ORDER = {
  batting: ROLE_GROUP_ORDER,
  bowling: ['BOWL','AR','BAT','WK'],
  fielding: ['WK','BAT','AR','BOWL'],
};

/* ---- Player Selection (under Match) ---- */
function renderAdminXiScreen(){
  const html = `
    ${adminBackBtnHtml()}
    <h4 style="margin:12px 0 10px; font-family:var(--font-display);">Playing XI &amp; automatic substitutions <button type="button" class="help-icon" id="playingXiHelpBtn" title="What's this?" aria-label="Help">?</button></h4>
    <div id="playingXiWrap"></div>
    <div class="save-bar"><button class="btn secondary" id="savePlayingXiBtn">Save playing XI</button></div>
  `;
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='match'; renderAdminHub(); });
    c.querySelector('#playingXiHelpBtn').addEventListener('click', ()=> showAlert("Tick who actually took the field once the real teams are announced — this both drives automatic substitutions (anyone in a fantasy team's locked XI who isn't ticked is replaced by their first bench player, in squad order, who is — same idea as Fantasy Premier League's autosubs, with a captain's bonus passing to the vice-captain if the captain didn't play) and decides who you can log scoring against on the Scoring screen. Leave everyone unticked until the real teams are out.", 'Playing XI & automatic substitutions'));
    renderPlayingXiTable(adminMatchTest);
  };
  return {html, wire};
}

/* Two-column checklist (one per series team) of who actually took the field
   for a Test — this is what resolveEffectiveXi() reads to work out automatic
   substitutions. */
function renderPlayingXiTable(testNum){
  const wrap = document.getElementById('playingXiWrap');
  if(!wrap) return;
  if(!playingXiPoolTeam || !adminSeriesTeams.some(t=>t.short_code===playingXiPoolTeam)) playingXiPoolTeam = adminSeriesTeams[0].short_code;
  const rowHtml = (p)=> `
    <label class="teamnews-row" style="cursor:pointer;">
      <span class="player-name">${p.name}</span>
      <span class="teamnews-row-right">
        <span class="role-pill">${ROLE_LABEL[p.role]}</span>
        <input type="checkbox" data-pid="${p.id}" ${currentPlayingXiDraft.includes(p.id)?'checked':''}>
      </span>
    </label>`;
  const playedCount = code=> adminPlayers.filter(p=>p.nat===code && currentPlayingXiDraft.includes(p.id)).length;
  // Both teams' checklists render at once (each its own .admin-subpanel) so
  // switching the tab is a plain local class-toggle — same as every other
  // tab bar in the app — rather than re-rendering anything.
  wrap.innerHTML = `
    <div class="admin-subnav light-subnav even-tabs">
      ${adminSeriesTeams.map(t=>`<button class="subtab-btn${t.short_code===playingXiPoolTeam?' active':''}" data-xiteam="${t.short_code}">${t.short_code} (${playedCount(t.short_code)}/11)</button>`).join('')}
    </div>
    ${adminSeriesTeams.map(t=>`
      <div class="admin-subpanel${t.short_code===playingXiPoolTeam?' active':''}" data-xipanel="${t.short_code}" style="margin-top:12px;">
        ${adminPlayers.filter(p=>p.nat===t.short_code).map(rowHtml).join('')}
      </div>
    `).join('')}`;
  wrap.querySelectorAll('[data-xiteam]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      playingXiPoolTeam = btn.dataset.xiteam;
      wrap.querySelectorAll('[data-xiteam]').forEach(b=> b.classList.toggle('active', b===btn));
      wrap.querySelectorAll('[data-xipanel]').forEach(p=> p.classList.toggle('active', p.dataset.xipanel===btn.dataset.xiteam));
    });
  });
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const pid = cb.dataset.pid;
      currentPlayingXiDraft = cb.checked
        ? [...currentPlayingXiDraft.filter(id=>id!==pid), pid]
        : currentPlayingXiDraft.filter(id=>id!==pid);
      // Scoring reads currentPlayingXiDraft fresh whenever it's next entered
      // (a separate screen now, not a hidden tab sharing this DOM) — no
      // #statsTableWrap to refresh in place from here.
      renderPlayingXiTable(testNum);
    });
  });
  const saveBtn = document.getElementById('savePlayingXiBtn');
  if(saveBtn) saveBtn.onclick = async ()=>{
    const {error} = await supabaseClient.from('match_stats').upsert({series_id: adminSeriesId, test: testNum, playing_xi: currentPlayingXiDraft});
    if(error){ showAlert(error.message); return; }
    showAlert('Playing XI saved for Test '+testNum+'.');
  };
}

/* ---- Scoring (under Match) ---- */
function renderAdminScoringScreen(){
  const html = `
    ${adminBackBtnHtml()}
    <h4 style="margin:12px 0 4px; font-family:var(--font-display);">Innings &amp; scoring <button type="button" class="help-icon" id="lockingHelpBtn" title="What does locking do?" aria-label="Help">?</button></h4>
    <div id="statsTableWrap"></div>
    <div class="save-bar">
      <button class="btn secondary" id="saveStatsBtn">Save stats (don't lock yet)</button>
      <button class="btn" id="lockTestBtn">Save stats &amp; lock this Test for all leagues on this series</button>
    </div>
  `;
  const wire = c=>{
    c.querySelector('#adminBackBtn').addEventListener('click', ()=>{ adminScreen='match'; renderAdminHub(); });
    c.querySelector('#lockingHelpBtn').addEventListener('click', ()=> showAlert("Runs/wickets/catches etc. are tracked per innings and summed automatically for scoring — a century in each innings both count. Locking snapshots every saved squad's current XI/captain, in every league on this series, into this Test's scoring record and resets their 2-swap window for the next Test.", 'Innings & scoring'));
    renderStatsTable(adminMatchTest);
  };
  return {html, wire};
}

/* Innings are added one at a time by an admin picking who's batting — up to
   4 total (2 per side), in whatever order they actually happened. Bowling
   and fielding for an innings always belong to the OTHER series team, since
   that's who's on the field while this team bats. */
function battingTeamFor(entry){ return adminSeriesTeams.find(t=>t.short_code===entry.battingCode); }
function bowlingTeamFor(entry){ return adminSeriesTeams.find(t=>t.short_code!==entry.battingCode); }
function inningsKey(entry){ return entry.battingCode+'_inn'+entry.inn; }
function inningsLabel(entry){
  const t = battingTeamFor(entry);
  return (t ? t.name : entry.battingCode) + ' · Inn ' + entry.inn;
}
function availableBattingTeams(){
  return adminSeriesTeams.filter(t => currentInningsDraft.filter(e=>e.battingCode===t.short_code).length < 2);
}
function addInningsButtonHtml(){
  const avail = availableBattingTeams();
  if(currentInningsDraft.length>=4 || !avail.length) return '';
  return `<button type="button" class="innings-add-btn" id="addInningsBtn" title="Add innings" ${session?'':'disabled'}>+</button>`;
}
function wireAddInningsButton(container, testNum){
  const btn = container.querySelector('#addInningsBtn');
  if(!btn) return;
  btn.addEventListener('click', ()=> openAddInningsOverlay(testNum));
}
/* Lightbox for picking which team's batting the new innings belongs to — the
   other team is derived automatically as bowling/fielding (bowlingTeamFor),
   and if only one team still has room for another innings this skips the
   prompt entirely and adds it straight away. */
function openAddInningsOverlay(testNum){
  const avail = availableBattingTeams();
  if(!avail.length) return;
  if(avail.length===1){ addInningsEntry(avail[0].short_code, testNum); return; }
  const backdrop = openOverlay(`
    <div class="overlay-title">Add an innings</div>
    <div class="overlay-message">Which team's batting?</div>
    <div class="overlay-actions" style="justify-content:center; gap:14px;">
      ${avail.map(t=>`<button class="btn" data-addteam="${t.short_code}">${t.name}</button>`).join('')}
    </div>
  `);
  backdrop.querySelectorAll('[data-addteam]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ closeOverlay(); addInningsEntry(btn.dataset.addteam, testNum); });
  });
}
function addInningsEntry(code, testNum){
  const inn = currentInningsDraft.filter(e=>e.battingCode===code).length + 1;
  currentInningsDraft.push({battingCode: code, inn});
  activeInningsIdx = currentInningsDraft.length - 1;
  renderStatsTable(testNum);
}
function editInningsEntry(idx, testNum){
  const entry = currentInningsDraft[idx];
  const other = bowlingTeamFor(entry);
  if(!other) return;
  const clash = currentInningsDraft.some((e,i)=> i!==idx && e.battingCode===other.short_code && e.inn===entry.inn);
  if(clash){ showAlert(`${other.name} already has an Inn ${entry.inn} — remove that one first if you want to swap this one to them.`); return; }
  entry.battingCode = other.short_code;
  activeInningsIdx = idx;
  renderStatsTable(testNum);
}
async function deleteInningsEntry(idx, testNum){
  const entry = currentInningsDraft[idx];
  if(!(await showConfirm(`Remove ${inningsLabel(entry)}? Any stats already entered for it stay saved and reappear if you re-add it.`, 'Delete innings?'))) return;
  currentInningsDraft.splice(idx,1);
  activeInningsIdx = Math.max(0, Math.min(activeInningsIdx, currentInningsDraft.length-1));
  renderStatsTable(testNum);
}

// An innings only has 10 wickets to go around, in two senses this app cares
// about: the bowling table's wickets column can't credit more than 10 across
// all bowlers, and the fielding table's catches+stumpings+run-outs can't
// credit more than 10 dismissals between them either. CAP_KEYS says which
// stat(s) count toward that cap for a given category; categories not listed
// (batting) have no cap.
const CAP_KEYS = {bowling: ['wickets'], fielding: ['catches','stumpings','runouts']};
function statSum(pid, inn, keys){
  const s = (currentStatsDraft[pid]||{})[inn] || {};
  return keys.reduce((sum,k)=> sum + (s[k]||0), 0);
}
function categoryTotal(players, inn, keys){
  return players.reduce((sum,p)=> sum + statSum(p.id, inn, keys), 0);
}
/* Re-checks whether this table's cap (see CAP_KEYS) has been hit and, if so,
   disables every row that isn't itself contributing to the total — done by
   toggling .disabled directly on the existing inputs rather than
   re-rendering the table, so it can run on every keystroke without stealing
   focus mid-type. Rows already contributing stay editable (so a mistake can
   still be corrected back down, which re-enables everyone else). */
function applyCapLockouts(table, inn, category){
  const keys = CAP_KEYS[category];
  if(!keys) return;
  const rows = [...table.querySelectorAll('tr[data-pid]')];
  const total = rows.reduce((sum,r)=> sum + statSum(r.dataset.pid, inn, keys), 0);
  const capped = total >= 10;
  rows.forEach(r=>{
    const contributes = statSum(r.dataset.pid, inn, keys) > 0;
    const lock = capped && !contributes;
    r.querySelectorAll('input').forEach(inp=>{ inp.disabled = lock || !session; });
  });
}

function buildStatTable(nat, inn, category){
  const cols = STAT_COLUMN_GROUPS[category];
  const roleOrder = CATEGORY_ROLE_ORDER[category];
  const players = adminPlayers
    .filter(p=>p.nat===nat && currentPlayingXiDraft.includes(p.id))
    .sort((a,b)=> roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.name.localeCompare(b.name));
  const capKeys = CAP_KEYS[category];
  const capped = capKeys && categoryTotal(players, inn, capKeys) >= 10;
  return `
    <div class="table-scroll">
    <table class="stat-entry" data-category="${category}">
      <tr><th>Player</th>${cols.map(c=>`<th>${c.label}</th>`).join('')}</tr>
      ${players.length ? players.map(p=>{
        const playerStats = currentStatsDraft[p.id] || {};
        const s = playerStats[inn] || {};
        const lockedOut = capped && capKeys.every(k=>!s[k]);
        const disabled = !session || lockedOut;
        return `<tr data-pid="${p.id}" data-inn="${inn}">
          <td>${p.name}</td>
          ${cols.map(c=> c.type==='checkbox'
            ? `<td><input type="checkbox" data-k="${c.key}" ${s[c.key]?'checked':''} ${disabled?'disabled':''}></td>`
            : `<td><input type="number" min="0" data-k="${c.key}" value="${s[c.key]||''}" ${disabled?'disabled':''}></td>`
          ).join('')}
        </tr>`;
      }).join('') : `<tr><td colspan="${cols.length+1}" class="muted-on-light">No ${teamNameForCode(nat)} players ticked in the Playing XI.</td></tr>`}
    </table>
    </div>`;
}

function buildInningsPanel(entry, idx, isActive){
  const battingTeam = battingTeamFor(entry);
  const bowlingTeam = bowlingTeamFor(entry);
  const inn = 'inn'+entry.inn;
  return `
    <div class="admin-subpanel${isActive?' active':''}" data-inningspanel="${inningsKey(entry)}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">
        <p class="muted-on-light" style="font-size:12px; margin:0;">${battingTeam.name} batting · ${bowlingTeam.name} bowling &amp; fielding.</p>
        <span style="display:flex; gap:8px;">
          <button type="button" class="row-icon-btn primary" data-editinnings="${idx}" ${session?'':'disabled'} title="Change batting team" aria-label="Change batting team">&#8646;</button>
          <button type="button" class="row-icon-btn danger" data-delinnings="${idx}" ${session?'':'disabled'} title="Remove innings" aria-label="Remove innings">&times;</button>
        </span>
      </div>
      <div class="admin-subnav light-subnav" style="margin:6px 0 10px;">
        <button class="subtab-btn active" data-statcat="batting">Batting</button>
        <button class="subtab-btn" data-statcat="bowling">Bowling</button>
        <button class="subtab-btn" data-statcat="fielding">Fielding</button>
      </div>
      <div class="admin-subpanel active" data-statpanel="batting">${buildStatTable(battingTeam.short_code, inn, 'batting')}</div>
      <div class="admin-subpanel" data-statpanel="bowling">${buildStatTable(bowlingTeam.short_code, inn, 'bowling')}</div>
      <div class="admin-subpanel" data-statpanel="fielding">${buildStatTable(bowlingTeam.short_code, inn, 'fielding')}</div>
    </div>`;
}

function renderStatsTable(testNum){
  const wrap = document.getElementById('statsTableWrap');

  // Wired up front (not at the end) so these always close over the current
  // testNum, even when the branch below returns early with no innings yet —
  // these buttons live outside #statsTableWrap and persist across Test switches.
  document.getElementById('saveStatsBtn').onclick = async ()=>{
    const {error} = await supabaseClient.from('match_stats').upsert({series_id: adminSeriesId, test: testNum, stats: currentStatsDraft, innings: currentInningsDraft});
    if(error){ showAlert(error.message); return; }
    showAlert('Stats saved for Test '+testNum+'.');
  };
  document.getElementById('lockTestBtn').onclick = async ()=> lockTest(testNum);

  if(currentPlayingXiDraft.length===0){
    wrap.innerHTML = `
      <div class="empty-state" style="margin:12px 0;">
        Tick the Playing XI on Player Selection first — innings can only be added once at least one player's on the field.
        <div style="margin-top:14px;"><button type="button" class="btn secondary small" id="goToXiFromScoringBtn">Go to Player Selection</button></div>
      </div>`;
    const goBtn = document.getElementById('goToXiFromScoringBtn');
    if(goBtn) goBtn.addEventListener('click', ()=>{ adminScreen='xi'; renderAdminHub(); });
    return;
  }

  if(currentInningsDraft.length===0){
    wrap.innerHTML = `
      <div class="empty-state" style="margin:12px 0 10px;">No innings added yet for this Test.</div>
      <div class="innings-tabrow">${addInningsButtonHtml()}</div>
    `;
    wireAddInningsButton(wrap, testNum);
    return;
  }

  activeInningsIdx = Math.max(0, Math.min(activeInningsIdx, currentInningsDraft.length-1));
  wrap.innerHTML = `
    <div class="innings-tabrow admin-subnav light-subnav" style="margin-top:12px;">
      ${currentInningsDraft.map((entry,i)=>`<button class="subtab-btn${i===activeInningsIdx?' active':''}" data-inningskey="${inningsKey(entry)}" data-inningsidx="${i}">${inningsLabel(entry)}</button>`).join('')}
      ${addInningsButtonHtml()}
    </div>
    ${currentInningsDraft.map((entry,i)=> buildInningsPanel(entry, i, i===activeInningsIdx)).join('')}
  `;
  wireAddInningsButton(wrap, testNum);

  wrap.querySelectorAll('[data-editinnings]').forEach(btn=>{
    btn.addEventListener('click', ()=> editInningsEntry(parseInt(btn.dataset.editinnings), testNum));
  });
  wrap.querySelectorAll('[data-delinnings]').forEach(btn=>{
    btn.addEventListener('click', ()=> deleteInningsEntry(parseInt(btn.dataset.delinnings), testNum));
  });

  // outer: innings tabs
  wrap.querySelectorAll('[data-inningskey]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      activeInningsIdx = parseInt(btn.dataset.inningsidx);
      wrap.querySelectorAll('[data-inningskey]').forEach(b=> b.classList.toggle('active', b===btn));
      wrap.querySelectorAll('[data-inningspanel]').forEach(p=> p.classList.toggle('active', p.dataset.inningspanel===btn.dataset.inningskey));
    });
  });

  // inner: batting/bowling/fielding tabs, scoped to their own innings panel
  wrap.querySelectorAll('[data-inningspanel]').forEach(panel=>{
    panel.querySelectorAll('[data-statcat]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        panel.querySelectorAll('[data-statcat]').forEach(b=> b.classList.toggle('active', b===btn));
        panel.querySelectorAll('[data-statpanel]').forEach(p=> p.classList.toggle('active', p.dataset.statpanel===btn.dataset.statcat));
      });
    });
  });

  wrap.querySelectorAll('tr[data-pid]').forEach(row=>{
    const pid = row.dataset.pid;
    const inn = row.dataset.inn;
    row.querySelectorAll('input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        if(!currentStatsDraft[pid]) currentStatsDraft[pid] = {};
        if(!currentStatsDraft[pid][inn]) currentStatsDraft[pid][inn] = {};
        const k = inp.dataset.k;
        currentStatsDraft[pid][inn][k] = inp.type==='checkbox' ? inp.checked : parseInt(inp.value)||0;

        // Runs -> Duck/50/100 auto-tick (still just a checkbox afterward, so
        // e.g. a not-out on 0 can be manually unticked). 100 and 50 stay
        // mutually exclusive, matching the "100 replaces the 50 bonus" rule.
        if(k==='runs'){
          const entryStats = currentStatsDraft[pid][inn];
          const runs = entryStats.runs||0;
          entryStats.duck = runs===0;
          entryStats.hundred = runs>=100;
          entryStats.fifty = runs>=50 && runs<100;
          const duckCb = row.querySelector('[data-k="duck"]');
          const fiftyCb = row.querySelector('[data-k="fifty"]');
          const hundredCb = row.querySelector('[data-k="hundred"]');
          if(duckCb) duckCb.checked = entryStats.duck;
          if(fiftyCb) fiftyCb.checked = entryStats.fifty;
          if(hundredCb) hundredCb.checked = entryStats.hundred;
        }
        // Wickets -> 4-fer/5-fer auto-tick, same idea (mutually exclusive).
        if(k==='wickets'){
          const entryStats = currentStatsDraft[pid][inn];
          const wkts = entryStats.wickets||0;
          entryStats.fiveWkt = wkts>=5;
          entryStats.fourWkt = wkts===4;
          const fourCb = row.querySelector('[data-k="fourWkt"]');
          const fiveCb = row.querySelector('[data-k="fiveWkt"]');
          if(fourCb) fourCb.checked = entryStats.fourWkt;
          if(fiveCb) fiveCb.checked = entryStats.fiveWkt;
        }

        // An innings only has 10 wickets between the bowlers, and 10
        // dismissals between catches/stumpings/run-outs — once either total
        // is reached, grey out whoever isn't contributing so no one can
        // enter an 11th. See applyCapLockouts().
        const table = row.closest('table.stat-entry');
        const category = table && table.dataset.category;
        if((category==='bowling' || category==='fielding') && CAP_KEYS[category].includes(k)){
          applyCapLockouts(table, inn, category);
        }
      });
    });
  });

}

async function lockTest(testNum){
  if(!(await showConfirm(`This snapshots every league's committed XI on this series for scoring, and becomes their new baseline for the next round of changes.`, `Lock Test ${testNum}?`))) return;
  const {error: statsErr} = await supabaseClient.from('match_stats').upsert({series_id: adminSeriesId, test: testNum, stats: currentStatsDraft, playing_xi: currentPlayingXiDraft, innings: currentInningsDraft});
  if(statsErr){ showAlert(statsErr.message); return; }

  const {error} = await supabaseClient.rpc('lock_test', {p_series_id: adminSeriesId, p_test: testNum});
  if(error){ showAlert('Could not lock Test: '+error.message); return; }

  if(adminSeriesId === currentSeriesId) await loadMySquads();
  showAlert(`Test ${testNum} locked. All lineups on this series snapshotted and scored.`);
  renderAll();
}

/* The undo for everything Match Setup can do to a Test — see reset_test() in
   supabase-schema.sql for what it rolls back server-side. Deliberately
   doesn't go via renderAll() (which would bounce back to the top of Admin
   Hub) — the player-facing views are refreshed individually and the Test's
   draft is reloaded via goToAdminMatch, leaving the admin on the Match
   screen for the same Test they were just resetting. */
async function resetTest(testNum){
  const fixture = adminFixtures.find(f=>f.test===testNum);
  if(!(await showConfirm(
    `Every stat, the Playing XI and all innings for Test ${testNum}${fixture?' ('+fixture.venue+')':''} will be deleted, and its lock undone across every league on this series: the snapshotted XIs are removed so it scores nothing, transfer baselines roll back to the previous locked Test, and any wildcard spent on this Test is handed back to whoever spent it. This can't be undone.`,
    `Reset Test ${testNum}?`
  ))) return;

  const {error} = await supabaseClient.rpc('reset_test', {p_series_id: adminSeriesId, p_test: testNum});
  if(error){ showAlert('Could not reset Test: '+error.message); return; }

  if(adminSeriesId === currentSeriesId){
    await loadMySquads();
    await loadSeriesPlayerTotals(currentSeriesId);
    renderMyXI();
  }
  renderLeaderboard();
  await goToAdminMatch(testNum);
  showAlert(`Test ${testNum} reset — it's back to how it was before it began.`);
}
