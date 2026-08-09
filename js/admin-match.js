/* js/admin-match.js — Admin tab: entering match stats, Playing XI, and locking a Test. */
/* ================= MATCH CENTRE ================= */
/* ================= ADMIN: MATCH SETUP (stats + lock) ================= */
async function renderMatchSetup(){
  const c = document.getElementById('matchSetupContent');
  if(!c) return;
  if(!supabaseClient){ c.innerHTML = `<div class="empty-state">Configure Supabase first.</div>`; return; }
  if(!isAdmin){ c.innerHTML = `<div class="empty-state"><div class="big">Admins only</div></div>`; return; }
  if(!adminSeriesId) adminSeriesId = seriesList[0] ? seriesList[0].id : null;
  if(!adminSeriesId){
    c.innerHTML = `<h3 style="margin-top:0; font-family:var(--font-display);">Enter match stats &amp; lock a Test</h3>${adminSeriesPickerHtml()}`;
    return;
  }
  adminPlayers = await fetchPlayers(adminSeriesId);
  adminPlayerMap = Object.fromEntries(adminPlayers.map(p=>[p.id,p]));
  adminFixtures = await fetchFixtures(adminSeriesId);
  adminSeriesTeams = resolveSeriesTeams(adminSeriesId, adminPlayers);

  c.innerHTML = `
    <h3 style="margin-top:0; font-family:var(--font-display);">Enter match stats &amp; lock a Test</h3>
    <p class="panel-sub">Enter each player's numbers after a Test finishes, then lock it in for scoring.</p>
    ${adminSeriesPickerHtml()}
    ${adminSeriesTeams.length<2 ? '<div class="empty-state">This series needs both teams assigned first — set them under Admin &rarr; Series Setup.</div>' :
      adminFixtures.length===0 ? '<div class="empty-state">This series has no fixtures yet — add some under Admin &rarr; Series Setup.</div>' : `
    <div class="card">
      <label class="field-label">Test</label>
      <select class="pick" id="statsTestSelect" style="max-width:260px;">
        ${adminFixtures.map(f=>`<option value="${f.test}">Test ${f.test} — ${f.venue}</option>`).join('')}
      </select>
      <h4 style="margin:18px 0 4px; font-family:var(--font-display);">1. Playing XI &amp; automatic substitutions</h4>
      <p class="muted-on-light" style="font-size:12px; margin:0 0 10px;">Tick who actually took the field once the real teams are announced — this both drives automatic substitutions (anyone in a fantasy team's locked XI who isn't ticked is replaced by their first bench player, in squad order, who is — same idea as Fantasy Premier League's autosubs, with a captain's bonus passing to the vice-captain if the captain didn't play) and decides who you can log scoring against below. Leave everyone unticked until the real teams are out.</p>
      <div id="playingXiWrap"></div>
      <div class="save-bar"><button class="btn secondary" id="savePlayingXiBtn">Save playing XI</button></div>

      <h4 style="margin:24px 0 4px; font-family:var(--font-display);">2. Innings &amp; scoring</h4>
      <div id="statsTableWrap"></div>
      <div class="save-bar">
        <button class="btn secondary" id="saveStatsBtn">Save stats (don't lock yet)</button>
        <button class="btn" id="lockTestBtn">Save stats &amp; lock this Test for all leagues on this series</button>
      </div>
      <p class="muted-on-light" style="font-size:12px; margin-top:8px;">Locking snapshots every saved squad's current XI/captain, in every league on this series, into this Test's scoring record and resets their 2-swap window for the next Test.</p>
    </div>
    `}
  `;
  wireAdminSeriesPicker(c, renderMatchSetup);

  const testSelect = document.getElementById('statsTestSelect');
  if(testSelect){
    testSelect.addEventListener('change', ()=> loadAndRenderMatchSetup(parseInt(testSelect.value)));
    if(adminFixtures.length) loadAndRenderMatchSetup(adminFixtures[0].test);
  }
}

async function loadAndRenderMatchSetup(testNum){
  const {stats, playingXi, innings} = await getMatchDataForTest(adminSeriesId, testNum);
  currentStatsDraft = JSON.parse(JSON.stringify(stats));
  currentPlayingXiDraft = [...playingXi];
  currentInningsDraft = innings.map(e=>({...e}));
  activeInningsIdx = 0;
  renderStatsTable(testNum);
  renderPlayingXiTable(testNum);
}

let currentStatsDraft = {};
let currentPlayingXiDraft = [];
let currentInningsDraft = []; // [{battingCode, inn}] in the order they were added, max 4, max 2 per team
let activeInningsIdx = 0;
let adminSeriesTeams = []; // the two {id,name,short_code} teams for adminSeriesId — see resolveSeriesTeams()
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
  btn.addEventListener('click', ()=>{
    const avail = availableBattingTeams();
    if(avail.length===1){ addInningsEntry(avail[0].short_code, testNum); return; }
    // Two teams still available — swap the + for a couple of team-code
    // buttons in place, rather than popping any kind of dialog.
    const holder = btn.parentElement;
    holder.innerHTML = avail.map(t=>`<button type="button" class="innings-add-btn" data-addteam="${t.short_code}" style="width:auto; padding:0 8px;">${t.short_code}</button>`).join('')
      + `<button type="button" class="innings-add-btn" data-addcancel="1" title="Cancel">&times;</button>`;
    holder.querySelectorAll('[data-addteam]').forEach(b=> b.addEventListener('click', ()=> addInningsEntry(b.dataset.addteam, testNum)));
    holder.querySelector('[data-addcancel]').addEventListener('click', ()=> renderStatsTable(testNum));
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

function buildStatTable(nat, inn, category){
  const cols = STAT_COLUMN_GROUPS[category];
  const players = adminPlayers.filter(p=>p.nat===nat && currentPlayingXiDraft.includes(p.id));
  return `
    <div class="table-scroll">
    <table class="stat-entry">
      <tr><th>Player</th>${cols.map(c=>`<th>${c.label}</th>`).join('')}</tr>
      ${players.length ? players.map(p=>{
        const playerStats = currentStatsDraft[p.id] || {};
        const s = playerStats[inn] || {};
        return `<tr data-pid="${p.id}" data-inn="${inn}">
          <td>${p.name}</td>
          ${cols.map(c=> c.type==='checkbox'
            ? `<td><input type="checkbox" data-k="${c.key}" ${s[c.key]?'checked':''} ${session?'':'disabled'}></td>`
            : `<td><input type="number" min="0" data-k="${c.key}" value="${s[c.key]||0}" ${session?'':'disabled'}></td>`
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
        <span style="display:flex; gap:12px;">
          <button type="button" class="link-btn on-light" data-editinnings="${idx}" ${session?'':'disabled'}>Change batting team</button>
          <button type="button" class="link-btn" data-delinnings="${idx}" style="color:var(--oxblood);" ${session?'':'disabled'}>Remove innings</button>
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
    wrap.innerHTML = `<div class="empty-state" style="margin:12px 0;">Tick the Playing XI above first — innings can only be added once at least one player's on the field.</div>`;
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
    <p class="muted-on-light" style="font-size:12px; margin:12px 0 4px;">Runs/wickets/catches etc. are tracked per innings and summed automatically for scoring — a century in each innings both count.</p>
    <div class="innings-tabrow admin-subnav light-subnav" style="margin-top:6px;">
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
      });
    });
  });

}

/* Two-column checklist (one per series team) of who actually took the field
   for a Test — this is what resolveEffectiveXi() reads to work out automatic
   substitutions. */
function renderPlayingXiTable(testNum){
  const wrap = document.getElementById('playingXiWrap');
  if(!wrap) return;
  const rowHtml = (p)=> `
    <label class="teamnews-row" style="cursor:pointer;">
      <span>${p.name} <span class="role-pill">${ROLE_LABEL[p.role]}</span></span>
      <input type="checkbox" data-pid="${p.id}" ${currentPlayingXiDraft.includes(p.id)?'checked':''}>
    </label>`;
  const [teamA, teamB] = adminSeriesTeams;
  const playedCount = code=> adminPlayers.filter(p=>p.nat===code && currentPlayingXiDraft.includes(p.id)).length;
  wrap.innerHTML = `
    <div class="rules-grid">
      <div class="nation-block">
        <div class="nation-heading"><span class="flag-chip team-a">${teamA.short_code}</span> ${teamA.name} XI (${playedCount(teamA.short_code)}/11 ticked)</div>
        ${adminPlayers.filter(p=>p.nat===teamA.short_code).map(rowHtml).join('')}
      </div>
      <div class="nation-block">
        <div class="nation-heading"><span class="flag-chip team-b">${teamB.short_code}</span> ${teamB.name} XI (${playedCount(teamB.short_code)}/11 ticked)</div>
        ${adminPlayers.filter(p=>p.nat===teamB.short_code).map(rowHtml).join('')}
      </div>
    </div>`;
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const pid = cb.dataset.pid;
      currentPlayingXiDraft = cb.checked
        ? [...currentPlayingXiDraft.filter(id=>id!==pid), pid]
        : currentPlayingXiDraft.filter(id=>id!==pid);
      renderPlayingXiTable(testNum);
      renderStatsTable(testNum);
    });
  });
  const saveBtn = document.getElementById('savePlayingXiBtn');
  if(saveBtn) saveBtn.onclick = async ()=>{
    const {error} = await supabaseClient.from('match_stats').upsert({series_id: adminSeriesId, test: testNum, playing_xi: currentPlayingXiDraft});
    if(error){ showAlert(error.message); return; }
    showAlert('Playing XI saved for Test '+testNum+'.');
  };
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

