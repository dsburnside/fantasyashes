/* js/leagues.js — the My Leagues tab: create/join a league, and its leaderboard. */
/* ================= MY LEAGUES TAB (self-service create/join leagues + standings) ================= */
function genJoinCode(){
  return 'L' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
/* Tab strip for switching between the leagues you're in — standings for
   whichever one is active are the main event on this page now; creating or
   joining another happens behind the "+" (openLeagueAddOverlay()) instead of
   permanently-visible forms, to keep this down to just the tabs. */
function leagueTabsHtml(){
  return `
    <div class="admin-subnav league-tabs" id="leagueTabs">
      ${myLeagues.map(l=>`<button class="subtab-btn${l.id===currentLeagueId?' active':''}" data-lid="${l.id}">${l.name}</button>`).join('')}
      <button type="button" class="tab-add-btn" id="leagueAddBtn" title="Create or join a league">+</button>
    </div>`;
}
/* Scoped to a container, not document.getElementById — this tab strip could
   in principle exist more than once in the DOM (only one tab panel is
   visible at a time, others stay hidden), so an unscoped lookup could wire
   the wrong copy and leave the visible one dead. */
function wireLeagueTabs(container){
  container.querySelectorAll('#leagueTabs [data-lid]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchToLeague(btn.dataset.lid));
  });
  const addBtn = container.querySelector('#leagueAddBtn');
  if(addBtn) addBtn.addEventListener('click', openLeagueAddOverlay);
}

/* Create-or-join modal reached from the "+" at the end of the league tabs. */
function openLeagueAddOverlay(){
  const backdrop = openOverlay(`
    <div class="overlay-title">Add a league</div>
    <div class="admin-subnav" style="margin-bottom:16px;">
      <button class="subtab-btn active" data-addsub="create">Create</button>
      <button class="subtab-btn" data-addsub="join">Join with code</button>
    </div>
    <div data-addpanel="create">
      ${seriesList.length===0 ? '<div class="empty-state">No series available yet — ask an admin to set one up.</div>' : `
      <div class="field-group"><label for="newLeagueName">Name</label><input type="text" id="newLeagueName" placeholder="e.g. Office League"></div>
      <div class="field-group">
        <label for="newLeagueSeries">Series</label>
        <select class="pick" id="newLeagueSeries">${seriesList.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select>
      </div>
      <div class="auth-error" id="createLeagueError"></div>
      <div class="overlay-actions"><button class="btn" id="createLeagueBtn">Create league</button></div>
      `}
    </div>
    <div data-addpanel="join" style="display:none;">
      <div class="field-group"><label for="joinCodeInput">Join code</label><input type="text" id="joinCodeInput" placeholder="e.g. ASHES2026" style="text-transform:uppercase;"></div>
      <div class="auth-error" id="joinCodeError"></div>
      <div class="overlay-actions"><button class="btn" id="joinCodeBtn">Join league</button></div>
    </div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });

  backdrop.querySelectorAll('[data-addsub]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      backdrop.querySelectorAll('[data-addsub]').forEach(b=> b.classList.toggle('active', b===btn));
      backdrop.querySelectorAll('[data-addpanel]').forEach(p=> p.style.display = p.dataset.addpanel===btn.dataset.addsub ? '' : 'none');
    });
  });

  const createBtn = backdrop.querySelector('#createLeagueBtn');
  if(createBtn) createBtn.addEventListener('click', async ()=>{
    const name = backdrop.querySelector('#newLeagueName').value.trim();
    const seriesId = backdrop.querySelector('#newLeagueSeries').value;
    const errBox = backdrop.querySelector('#createLeagueError');
    if(!name){ errBox.textContent = 'Enter a league name.'; return; }
    createBtn.disabled = true;
    const code = genJoinCode();
    const createdByName = [myFirstName, myLastName].filter(Boolean).join(' ') || null;
    const {data, error} = await supabaseClient.from('leagues').insert({name, series_id: seriesId, join_code: code, created_by: session.user.id, created_by_name: createdByName}).select().single();
    if(error){ createBtn.disabled = false; errBox.textContent = error.message; return; }
    const {error: memberErr} = await supabaseClient.from('league_members').insert({league_id: data.id, user_id: session.user.id});
    if(memberErr) console.error(memberErr); // non-fatal — they can still join with the code themselves
    currentLeagueId = data.id;
    localStorage.setItem('currentLeagueId', currentLeagueId);
    await loadMyLeagues();
    closeOverlay();
    renderLeaderboard();
    showAlert(`League created — share this code so friends can join: ${code}`, `${name} created`);
  });

  const joinBtn = backdrop.querySelector('#joinCodeBtn');
  const input = backdrop.querySelector('#joinCodeInput');
  const joinErrBox = backdrop.querySelector('#joinCodeError');
  if(joinBtn) joinBtn.addEventListener('click', async ()=>{
    const code = input.value.trim().toUpperCase();
    if(!code){ joinErrBox.textContent = 'Enter a join code.'; return; }
    joinBtn.disabled = true;
    const {data, error} = await supabaseClient.rpc('resolve_join_code', {p_code: code});
    if(error){ joinBtn.disabled = false; joinErrBox.textContent = error.message; return; }
    if(!data || data.length===0){ joinBtn.disabled = false; joinErrBox.textContent = 'No league found for that code.'; return; }
    const league = data[0];
    const {error: memberErr} = await supabaseClient.from('league_members').insert({league_id: league.id, user_id: session.user.id});
    joinBtn.disabled = false;
    if(memberErr){
      joinErrBox.textContent = memberErr.code==='23505' ? "You're already in that league." : memberErr.message;
      return;
    }
    currentLeagueId = league.id;
    localStorage.setItem('currentLeagueId', currentLeagueId);
    await loadMyLeagues();
    closeOverlay();
    renderLeaderboard();
    const hasTeam = mySquads.some(s=>s.seriesId===league.series_id);
    showAlert(hasTeam
      ? `Joined ${league.name}.`
      : `Joined ${league.name} — you don't have a team on this series yet. Pick one in My Squads to appear on the leaderboard.`, 'Joined');
  });
}


/* ================= LEADERBOARD ================= */
/* Fetches everything first and writes c.innerHTML exactly once at the end —
   see the equivalent comment on renderSeriesSetup() in admin-series.js for
   why: the old version wrote a "Loading leaderboard…" placeholder into the
   DOM immediately and only replaced it with the real (often much taller)
   standings after several awaits, which collapsed the page out from under
   anyone scrolled down mid-list and left mobile scroll position clamped at
   the top once it re-expanded. Switching league tabs, or any action here
   that reloads the board, went through that same gap. */
async function renderLeaderboard(){
  const c = document.getElementById('leaderboardContent');
  if(!supabaseClient){ c.innerHTML = `<div class="empty-state">Configure Supabase first.</div>`; return; }
  if(!session){ c.innerHTML = `<div class="empty-state"><div class="big">Log in to see My Leagues</div></div>`; return; }

  const league = myLeagues.find(l=>l.id===currentLeagueId);
  let bodyHtml;
  let postWire = ()=>{};

  if(!league){
    bodyHtml = myLeagues.length===0
      ? `<div class="empty-state"><div class="big">No leagues yet</div>Tap the + above to create one or join with a code.</div>`
      : `<div class="empty-state">Pick a league above to see its standings.</div>`;
  } else {
    const canManage = isAdmin || league.createdBy === session.user.id;
    const seriesName = (seriesList.find(s=>s.id===league.seriesId)||{}).name || 'series';
    const cardHeadHtml = `
      <div class="flex-between" style="margin-bottom:10px;">
        <h3 style="margin:0; font-family:var(--font-display);">${league.name}</h3>
        <span class="role-pill">${seriesName}</span>
      </div>`;
    const actionBarHtml = `
      <div class="save-bar" style="margin-top:16px; justify-content:flex-end;">
        <button class="btn secondary small" id="copyLeagueLinkBtn">Copy invite link</button>
        ${canManage ? `<button class="btn secondary small" id="regenLeagueCodeBtn">New code</button><button class="btn small danger" id="deleteLeagueBtn">Delete league</button>` : ''}
      </div>`;
    const wireActionBar = ()=>{
      document.getElementById('copyLeagueLinkBtn').addEventListener('click', async ()=>{
        const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(league.joinCode||'')}`;
        try{
          await navigator.clipboard.writeText(link);
          showAlert(`Copied an invite link — anyone who opens it (and logs in or signs up) is prompted to join with code "${league.joinCode}".`, 'Copied');
        }catch(e){
          showAlert(`Invite link: ${link}`, 'Invite link');
        }
      });
      const regenBtn = document.getElementById('regenLeagueCodeBtn');
      if(regenBtn) regenBtn.addEventListener('click', async ()=>{
        const {error} = await supabaseClient.from('leagues').update({join_code: genJoinCode()}).eq('id', league.id);
        if(error){ showAlert(error.message); return; }
        await loadMyLeagues();
        renderLeaderboard();
      });
      const delBtn = document.getElementById('deleteLeagueBtn');
      if(delBtn) delBtn.addEventListener('click', async ()=>{
        if(!(await showConfirm("Delete this league? Members' teams aren't affected — they're tied to the series, not this league — but this removes their membership and this league's leaderboard. This cannot be undone.", 'Delete league'))) return;
        if(!(await showPasswordConfirm('Enter your account password to finish deleting this league.', 'Confirm deletion'))) return;
        const {error} = await supabaseClient.from('leagues').delete().eq('id', league.id);
        if(error){ showAlert(error.message); return; }
        currentLeagueId = null;
        await loadMyLeagues();
        renderLeaderboard();
      });
    };

    // Fetched locally rather than reading the global PLAYERS/fixtures — those
    // are scoped to whatever series My XI currently has open, which can be a
    // completely different series from this league's.
    const leagueFixtures = await fetchFixtures(league.seriesId);
    const leaguePlayers = await fetchPlayers(league.seriesId);
    const leaguePlayerMap = Object.fromEntries(leaguePlayers.map(p=>[p.id,p]));
    const leaguePlayerName = id => (leaguePlayerMap[id] && leaguePlayerMap[id].name) || '(removed player)';

    const matchDataByTest = {};
    for(const f of leagueFixtures){
      matchDataByTest[f.test] = await getMatchDataForTest(league.seriesId, f.test);
    }

    // Squads no longer belong to a single league (the same squad can back
    // multiple leagues on one series), so the leaderboard has to fetch this
    // league's actual membership first, then only the matching squads.
    const {data: memberRows, error: memberErr} = await supabaseClient.from('league_members').select('user_id').eq('league_id', league.id);
    const memberIds = memberErr ? [] : (memberRows||[]).map(m=>m.user_id);

    let squadRows = [];
    let loadErr = memberErr || null;
    if(!loadErr && memberIds.length>0){
      const {data, error} = await supabaseClient.from('squads').select('*').eq('series_id', league.seriesId).in('user_id', memberIds);
      if(error) loadErr = error; else squadRows = data || [];
    }

    if(loadErr){
      bodyHtml = `<div class="empty-state">Could not load leaderboard: ${loadErr.message}</div>`;
    } else if(squadRows.length===0){
      bodyHtml = `<div class="card">${cardHeadHtml}<div class="empty-state"><div class="big">No teams yet</div>Build a squad to appear on the board.</div>${actionBarHtml}</div>`;
      postWire = wireActionBar;
    } else {
      const rows = buildStandingRows(squadRows, matchDataByTest);
      bodyHtml = `
        <div class="card">
          ${cardHeadHtml}
          ${rows.map((r,i)=>`
            <div class="player-row standing-row standing-row-full${i===0?' leader':''}" data-idx="${i}">
              <div class="standing-team-row">
                <span class="standing-rank">${i+1}</span>
                <span class="player-name">${r.name}</span>
              </div>
              <div class="standing-meta-row">
                <span class="muted-on-light" style="font-size:11px;">${r.managerName || ''}</span>
                <span class="standing-points">${r.total} pts</span>
              </div>
            </div>
          `).join('')}
          ${actionBarHtml}
        </div>
      `;
      // Tapping a team now opens its player-by-player breakdown in a lightbox
      // (see openTeamBreakdownOverlay) instead of expanding an inline Test-by-
      // test row — the Test-by-test detail isn't gone, it's just inside that
      // same lightbox now, below the player breakdown.
      postWire = ()=>{
        document.querySelectorAll('#leaderboardBody .standing-row').forEach((row,i)=>{
          row.addEventListener('click', ()=> openTeamBreakdownOverlay(rows[i], leaguePlayerMap, leaguePlayerName));
        });
        wireActionBar();
      };
    }
  }

  c.innerHTML = `
    <h2 class="panel-title">My Leagues <button type="button" class="help-icon" id="myLeaguesHelpBtn" title="What's this?" aria-label="Help">?</button></h2>
    ${leagueTabsHtml()}
    <div id="leaderboardBody">${bodyHtml}</div>
  `;
  document.getElementById('myLeaguesHelpBtn').addEventListener('click', ()=> showAlert("Standings for whichever league you're viewing — tap a tab to switch, or add one with the +.", 'My Leagues'));
  wireLeagueTabs(c);
  postWire();
}

/* Per-squad points/breakdown across every Test that's locked so far — the
   exact shape openTeamBreakdownOverlay renders. Takes an already-converted
   squad (rowToSquad's shape, which mySquad already is), not a raw DB row, so
   Home's own scoreboard card can build one for mySquad directly (see
   js/home.js) without a second squads fetch — buildStandingRows below is
   just this run over a whole league's worth of raw rows. */
function buildSquadBreakdownRow(squad, matchDataByTest){
  let total = 0;
  const byTest = {};
  Object.keys(squad.lockedXiByTest||{}).forEach(t=>{
    const lockedEntry = squad.lockedXiByTest[t];
    const {stats, playingXi} = matchDataByTest[t] || {stats:{}, playingXi:[]};
    const pts = computeTestScore(lockedEntry, stats, playingXi);
    const {effectiveXi, captainDidNotPlay} = resolveEffectiveXi(lockedEntry, playingXi);
    const subs = effectiveXi.filter(e=>e.subFor).map(e=>({out:e.subFor, in:e.pid}));
    // Per-player detail for exactly this Test's locked XI/bench (not summed
    // across the series) — what openTeamBreakdownOverlay's per-Test tabs
    // actually render. subOutOf/subInFor mark that player's own auto-sub
    // (if any) that Test, in whichever direction it went.
    const subOutMap = Object.fromEntries(subs.map(s=>[s.out, s.in]));
    const subInMap = Object.fromEntries(subs.filter(s=>s.in).map(s=>[s.in, s.out]));
    const playerRow = pid => {
      const s = stats ? stats[pid] : null;
      return {
        pid,
        isCaptain: pid===lockedEntry.captain,
        isViceCaptain: pid===lockedEntry.viceCaptain,
        subOutOf: subOutMap[pid] || null, // didn't play — replaced by this pid
        subInFor: subInMap[pid] || null,  // came on, replacing this pid
        points: Math.round(playerPointsForTest(lockedEntry, stats, pid, captainDidNotPlay)*10)/10,
        runs: statMetricTotal(s,'runs'), wickets: statMetricTotal(s,'wickets'),
        catches: statMetricTotal(s,'catches'), stumpings: statMetricTotal(s,'stumpings'), runouts: statMetricTotal(s,'runouts'),
      };
    };
    byTest[t] = {
      pts, captainDidNotPlay,
      xiRows: (lockedEntry.xi||[]).map(playerRow),
      benchRows: (lockedEntry.bench||[]).map(playerRow),
    };
    total += pts;
  });
  return {userId: squad.userId, name: squad.teamName, managerName: squad.managerName, total: Math.round(total*10)/10, byTest};
}

/* Every squad in a league, sorted highest points first. Pure function of
   already-fetched data, so it can run after every await has resolved rather
   than being interleaved with them. userId rides along on each row
   (renderLeaderboard itself never needed it, but Home's
   computeMyLeagueStanding() — js/home.js — uses it to pick "my" row out of
   the sorted list to report a rank). */
function buildStandingRows(squadRows, matchDataByTest){
  const rows = squadRows.map(rowRaw=> buildSquadBreakdownRow(rowToSquad(rowRaw), matchDataByTest));
  rows.sort((a,b)=> b.total - a.total);
  return rows;
}

/* This team's locked XI and bench, one tab per Test — tapping a row in the
   standings opens this. Starting XI first (in squad order), then the 3
   bench players in order (bench order is the sub-priority queue). Captain/
   VC and auto-subs can differ Test to Test (transfers, armband changes), so
   these are read from that Test's own locked snapshot rather than the
   squad's current state — same &#8646; swap icon used for "Replace" in My XI
   marks anyone who didn't play and was auto-subbed, in either direction. */
function openTeamBreakdownOverlay(r, leaguePlayerMap, leaguePlayerName){
  const getP = pid => leaguePlayerMap[pid] || {id:pid, name:'(removed player)', nat:'?', role:'BAT'};
  const testKeys = Object.keys(r.byTest).sort((a,b)=>a-b);

  if(testKeys.length===0){
    const backdrop = openOverlay(`
      <div class="overlay-title">${r.name}</div>
      <div class="overlay-message">${r.managerName ? r.managerName + ' &middot; ' : ''}${r.total} pts this series</div>
      <p class="auth-hint">No Tests locked yet for this team.</p>
    `);
    backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
    backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
    return;
  }

  const rowHtml = row=>{
    const p = getP(row.pid);
    // Fixed-width slot for the captain/VC badges — with or without one, the
    // player name itself always starts at the same x position, so the names
    // read as a clean left-aligned column instead of drifting per row.
    const badges = (row.isCaptain ? '<span class="honours-star" title="Captain">&#9733;</span>' : '')
      + (row.isViceCaptain ? '<span style="font-family:var(--font-mono); font-size:9.5px;">VC</span>' : '');
    const swap = row.subOutOf
      ? `<span class="sub-swap-icon" title="Didn't play — replaced by ${leaguePlayerName(row.subOutOf)}">&#8646;</span>`
      : row.subInFor
        ? `<span class="sub-swap-icon" title="Came on for ${leaguePlayerName(row.subInFor)}">&#8646;</span>`
        : '';
    return `<tr><td><span class="row-badge-slot">${badges}</span>${p.name}${swap}</td><td class="pts">${row.points}</td><td>${row.runs}</td><td>${row.wickets}</td><td>${row.catches}</td><td>${row.stumpings}</td><td>${row.runouts}</td></tr>`;
  };
  const defaultTest = testKeys[testKeys.length-1]; // most recently locked, i.e. the current-looking team

  const backdrop = openOverlay(`
    <div class="overlay-title">${r.name}</div>
    <div class="overlay-message">${r.managerName ? r.managerName + ' &middot; ' : ''}${r.total} pts this series</div>
    <div class="admin-subnav" style="margin:4px 0 14px;">
      ${testKeys.map(t=>`<button class="subtab-btn${t===defaultTest?' active':''}" data-testtab="${t}">Test ${t}</button>`).join('')}
    </div>
    ${testKeys.map(t=>{
      const d = r.byTest[t];
      return `
      <div class="admin-subpanel${t===defaultTest?' active':''}" data-testpanel="${t}">
        <div class="table-scroll">
        <table class="breakdown-table">
          <tr><th>Player</th><th>Pts</th><th>Runs</th><th>Wkts</th><th>Ct</th><th>St</th><th>RO</th></tr>
          <tr><td colspan="7" class="breakdown-group">Starting XI</td></tr>
          ${d.xiRows.map(rowHtml).join('')}
          <tr><td colspan="7" class="breakdown-group">Bench</td></tr>
          ${d.benchRows.map(rowHtml).join('')}
        </table>
        </div>
        <p style="font-size:11px; margin-top:8px; color:var(--parchment-dim);">${d.pts} pts this Test${d.captainDidNotPlay ? ' — Captain sat out, armband passed to Vice-Captain' : ''}</p>
      </div>`;
    }).join('')}
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelectorAll('[data-testtab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      backdrop.querySelectorAll('[data-testtab]').forEach(b=> b.classList.toggle('active', b===btn));
      backdrop.querySelectorAll('[data-testpanel]').forEach(p=> p.classList.toggle('active', p.dataset.testpanel===btn.dataset.testtab));
    });
  });
}

// Tab order for Player rankings specifically — Batters, Bowlers, All-rounders,
// Wicketkeepers. Deliberately its own constant rather than reusing
// ROLE_GROUP_ORDER (state.js), which is Batters/All-rounders/Wicketkeepers/
// Bowlers and stays that way for the My XI player picker.
const RANKING_ROLE_ORDER = ['BAT', 'BOWL', 'AR', 'WK'];
/* Every player in the series, grouped by base role and ranked by total
   points scored so far (plain rate — see statPointsBreakdown — since this is
   about the player's own output, not any one manager's team). Opened from
   the "Player rankings" button, independent of which team (if any) picked
   them. totals is {pid: {bat, bowl, field, total}}. */
function openPlayerRankingsOverlay(players, totals){
  const totalFor = pid => totals[pid] || {bat:0, bowl:0, field:0, total:0};
  const groups = RANKING_ROLE_ORDER.map(role=>({
    role,
    players: players.filter(p=>p.role===role)
      .sort((a,b)=> totalFor(b.id).total - totalFor(a.id).total || a.name.localeCompare(b.name)),
  })).filter(g=>g.players.length);

  const rowHtml = (p,i)=>{
    const t = totalFor(p.id);
    return `
      <div class="picker-row" style="cursor:default; flex-wrap:wrap;">
        <span><span class="standing-rank">${i+1}</span> ${p.name} <span class="nat-pill">${p.nat}</span></span>
        <span class="rank-total-points" title="Total points this series">${t.total} pts</span>
        <span class="picker-points" style="width:100%;">
          <span title="Batting points this series">Bat ${t.bat}</span>
          <span title="Bowling points this series">Bowl ${t.bowl}</span>
          <span title="Fielding points this series">Fld ${t.field}</span>
        </span>
      </div>`;
  };

  const backdrop = openOverlay(`
    <div class="overlay-title">Player rankings</div>
    <div class="overlay-message">Total points scored so far this series, ranked within each role.</div>
    ${groups.length ? `
      <div class="admin-subnav" style="margin:4px 0 14px;">
        ${groups.map((g,gi)=>`<button class="subtab-btn${gi===0?' active':''}" data-rankrole="${g.role}">${ROLE_LABEL[g.role]}</button>`).join('')}
      </div>
      ${groups.map((g,gi)=>`
        <div class="admin-subpanel${gi===0?' active':''}" data-rankpanel="${g.role}">
          <div class="picker-list" style="max-height:55vh; margin:0;">
            ${g.players.map(rowHtml).join('')}
          </div>
        </div>
      `).join('')}
    ` : '<p class="auth-hint">No players in this series yet.</p>'}
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelectorAll('[data-rankrole]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      backdrop.querySelectorAll('[data-rankrole]').forEach(b=> b.classList.toggle('active', b===btn));
      backdrop.querySelectorAll('[data-rankpanel]').forEach(p=> p.classList.toggle('active', p.dataset.rankpanel===btn.dataset.rankrole));
    });
  });
}

/* The best legal XI for a given Test, drawn from both series teams' full
   player pools rather than any one manager's squad — see computeTeamOfTest()
   for what "best legal" means. Tabbed one-per-fixture, defaulting to the
   most recent, same interaction as the team breakdown lightbox's Test tabs. */
function openTeamOfTestOverlay(leaguePlayers, leagueFixtures, matchDataByTest){
  // Only a Test an admin has actually entered stats for (Match Setup) gets a
  // tab — there's nothing to show, and nothing legal to pick, for one that's
  // still empty. This also means the last tab is always the current one:
  // whichever Test most recently had scores entered.
  const testKeys = leagueFixtures
    .map(f=>f.test)
    .filter(t => { const s = (matchDataByTest[t]||{}).stats; return s && Object.keys(s).length>0; })
    .sort((a,b)=>a-b);
  if(testKeys.length===0){
    const backdrop = openOverlay(`
      <div class="overlay-title">Team of the Test</div>
      <p class="auth-hint">No stats entered for any Test yet — check back once Match Setup has some scores in.</p>
    `);
    backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
    backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
    return;
  }
  const defaultTest = testKeys[testKeys.length-1];

  const panelHtml = t=>{
    const {stats} = matchDataByTest[t];
    const xi = computeTeamOfTest(leaguePlayers, stats);
    // Grouped by role (same Batters/Bowlers/All-rounders/Wicketkeepers order
    // as Player rankings — RANKING_ROLE_ORDER), each group already in points
    // order since computeTeamOfTest returns the whole XI points-sorted.
    const groups = RANKING_ROLE_ORDER.map(role=>({
      role,
      rows: xi.filter(row=>row.role===role),
    })).filter(g=>g.rows.length);
    return `
      <div class="admin-subpanel${t===defaultTest?' active':''}" data-totpanel="${t}">
        ${xi.length<11 ? `<p style="font-size:11px; color:var(--parchment-dim); margin:0 0 10px;">Only ${xi.length} player${xi.length===1?'':'s'} with stats recorded so far — not the full best XI yet.</p>` : ''}
        <div class="table-scroll">
        <table class="breakdown-table">
          <tr><th>Player</th><th>Pts</th><th>Runs</th><th>Wkts</th><th>Ct</th><th>St</th><th>RO</th></tr>
          ${groups.map(g=>`
            <tr><td colspan="7" class="breakdown-group">${ROLE_LABEL[g.role]}</td></tr>
            ${g.rows.map(row=>`
              <tr><td>${row.name} <span class="nat-pill">${row.nat}</span></td><td class="pts">${row.points}</td><td>${row.runs}</td><td>${row.wickets}</td><td>${row.catches}</td><td>${row.stumpings}</td><td>${row.runouts}</td></tr>
            `).join('')}
          `).join('')}
        </table>
        </div>
      </div>`;
  };

  const backdrop = openOverlay(`
    <div class="overlay-title">Team of the Test</div>
    <div class="overlay-message">The best legal XI (11 players, at least one wicketkeeper) by points scored, picked from both teams' full player pools regardless of anyone's fantasy squad.</div>
    <div class="admin-subnav" style="margin:4px 0 14px;">
      ${testKeys.map(t=>`<button class="subtab-btn${t===defaultTest?' active':''}" data-tottab="${t}">Test ${t}</button>`).join('')}
    </div>
    ${testKeys.map(panelHtml).join('')}
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelectorAll('[data-tottab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      backdrop.querySelectorAll('[data-tottab]').forEach(b=> b.classList.toggle('active', b===btn));
      backdrop.querySelectorAll('[data-totpanel]').forEach(p=> p.classList.toggle('active', p.dataset.totpanel===btn.dataset.tottab));
    });
  });
}
