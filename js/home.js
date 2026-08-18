/* js/home.js — the Home tab: a snapshot of your squad's points and where you
   stand in whichever leagues you're in on the currently active series. This
   is the app's landing tab (see index.html's bottom nav / tab-home), so it
   has to cover every state a first-time visitor could land in: logged out,
   logged in with no squad yet, and logged in with one. */

/* Per-squad series total — same per-Test loop buildStandingRows() (leagues.js)
   runs over a whole league's worth of squads, just for one. Kept separate
   from buildStandingRows rather than calling it with a single-row array,
   since here there's no league/rank to compute, only a total. */
function computeSquadTotal(squad, matchDataByTest){
  let total = 0;
  let testsScored = 0;
  Object.keys(squad.lockedXiByTest||{}).forEach(t=>{
    const lockedEntry = squad.lockedXiByTest[t];
    const {stats, playingXi} = matchDataByTest[t] || {stats:{}, playingXi:[]};
    total += computeTestScore(lockedEntry, stats, playingXi);
    testsScored++;
  });
  return {total: Math.round(total*10)/10, testsScored};
}

/* Top N players by total series points, for the Home tab's "Player
   rankings" summary card. Same total openPlayerRankingsOverlay ranks by
   (seriesPlayerTotals[pid].total), just flattened across every role instead
   of grouped, since a compact preview has no room for role tabs. */
function topPlayersByPoints(players, totals, n){
  return players
    .map(p=>({p, total: (totals[p.id]||{total:0}).total}))
    .sort((a,b)=> b.total - a.total || a.p.name.localeCompare(b.p.name))
    .slice(0, n);
}

/* The most recent Test with any stats entered, and its top N scorers — the
   same "last tab" Test openTeamOfTestOverlay defaults to (see its testKeys/
   defaultTest there), computed here too since the summary card previews
   that one Test rather than every Test at once. Returns {test: null, xi: []}
   if no Test has stats yet. */
function latestTeamOfTestPreview(fixturesList, matchDataByTest, n){
  const testKeys = fixturesList
    .map(f=>f.test)
    .filter(t=>{ const s = (matchDataByTest[t]||{}).stats; return s && Object.keys(s).length>0; })
    .sort((a,b)=>a-b);
  if(testKeys.length===0) return {test: null, xi: []};
  const test = testKeys[testKeys.length-1];
  const xi = computeTeamOfTest(PLAYERS, matchDataByTest[test].stats);
  return {test, xi: xi.slice(0, n)};
}

/* Where the signed-in user stands in one league — same member/squad fetch
   renderLeaderboard() (leagues.js) does for the whole board, but this only
   needs enough of it to report "you're Nth of M". matchDataByTest is passed
   in rather than re-fetched: every league surfaced on Home is scoped to
   currentSeriesId (see renderHome() below), so they all share the exact same
   Test data renderHome() already fetched once for the squad-total card. */
async function computeMyLeagueStanding(league, matchDataByTest){
  const {data: memberRows, error: memberErr} = await supabaseClient.from('league_members').select('user_id').eq('league_id', league.id);
  if(memberErr) return null;
  const memberIds = (memberRows||[]).map(m=>m.user_id);
  if(memberIds.length===0) return null;
  const {data: squadRows, error} = await supabaseClient.from('squads').select('*').eq('series_id', league.seriesId).in('user_id', memberIds);
  if(error || !squadRows || squadRows.length===0) return null;
  const rows = buildStandingRows(squadRows, matchDataByTest);
  const myIdx = rows.findIndex(r=>r.userId===session.user.id);
  if(myIdx===-1) return null;
  return {league, rank: myIdx+1, outOf: rows.length, points: rows[myIdx].total};
}

async function renderHome(){
  const c = document.getElementById('homeContent');
  if(!c) return;

  if(!session){
    c.innerHTML = `
      <h2 class="home-greeting">Welcome to The Fantasy Ashes</h2>
      <p class="panel-sub">Sign in to build your squad and see your points and league standing here. Until then, have a look through Rules to see how it all works.</p>
      <div class="card"><button class="btn" id="homeLoginBtn">Log in / sign up</button></div>
    `;
    document.getElementById('homeLoginBtn').addEventListener('click', ()=> showLoginOverlay(true));
    return;
  }

  if(!currentSeriesId || !mySquad){
    const activeSeries = seriesList.find(s=>s.id===currentSeriesId);
    // Same pill (and same overlay) My Squads' own header uses — see
    // openSeriesSwitchOverlay, js/overlays.js.
    const newSeriesOptions = seriesList.filter(s=> s.id!==currentSeriesId && !mySquads.some(sq=>sq.seriesId===s.id));
    c.innerHTML = `
      <div class="flex-between" style="margin-bottom:14px;">
        <h2 class="home-greeting" style="margin-bottom:0;">Welcome${myFirstName ? ', '+myFirstName : ''}</h2>
        ${currentSeriesId ? switcherPillHtml('homeSeriesPillBtn', activeSeries ? activeSeries.name : 'this series', 'Switch series') : ''}
      </div>
      <p class="panel-sub">${seriesList.length===0
        ? 'No series available yet — ask an admin to set one up.'
        : `You haven't built a squad${activeSeries ? ' for '+activeSeries.name : ''} yet — that's the only thing standing between you and a spot on the board.`}</p>
      ${seriesList.length ? `<div class="card"><button class="btn" id="homeBuildBtn">Build your XI</button></div>` : ''}
    `;
    const seriesPillBtn = document.getElementById('homeSeriesPillBtn');
    if(seriesPillBtn) seriesPillBtn.addEventListener('click', ()=> openSeriesSwitchOverlay(newSeriesOptions));
    const buildBtn = document.getElementById('homeBuildBtn');
    if(buildBtn) buildBtn.addEventListener('click', ()=> switchTab('myxi'));
    return;
  }

  // Fetch everything before touching the DOM — see renderAdminHub()
  // (admin-series.js) and renderLeaderboard() (leagues.js) for why: writing
  // c.innerHTML immediately and filling it in after later awaits collapses
  // the page out from under anyone already scrolled down, which mobile
  // browsers read as "jump to the top". Home is usually the very first thing
  // rendered so the risk is low here, but it's cheap to stay consistent.
  const activeSeries = seriesList.find(s=>s.id===currentSeriesId);
  const homeFixtures = await fetchFixtures(currentSeriesId);
  const matchDataByTest = {};
  for(const f of homeFixtures){
    matchDataByTest[f.test] = await getMatchDataForTest(currentSeriesId, f.test);
  }
  const {total: myTotal, testsScored} = computeSquadTotal(mySquad, matchDataByTest);
  // Same shape (and same builder) buildStandingRows() (leagues.js) produces
  // for every squad in a league — reused here for just mySquad so tapping
  // the scoreboard below can open the exact same full breakdown lightbox
  // (openTeamBreakdownOverlay) a league standings row does.
  const myBreakdownRow = buildSquadBreakdownRow(mySquad, matchDataByTest);

  // Only leagues on the squad currently being shown — a league on some other
  // series wouldn't share this Test data, and would need its own fetch/round
  // of queries to boot. Switch series in My XI to see this snapshot for a
  // different one.
  const leaguesHere = myLeagues.filter(l=>l.seriesId===currentSeriesId);
  const standings = (await Promise.all(leaguesHere.map(l=> computeMyLeagueStanding(l, matchDataByTest)))).filter(Boolean);

  const nextFixture = homeFixtures
    .filter(f=> new Date(f.deadline).getTime() > Date.now())
    .sort((a,b)=> new Date(a.deadline) - new Date(b.deadline))[0];

  // Previews for the two summary cards below — both drawn from data this
  // function already fetched for the scoreboard/standings above, so opening
  // either card's full lightbox (openPlayerRankingsOverlay/
  // openTeamOfTestOverlay, both in leagues.js) needs no extra fetch either.
  const topRanked = topPlayersByPoints(PLAYERS, seriesPlayerTotals, 3);
  const totPreview = latestTeamOfTestPreview(homeFixtures, matchDataByTest, 3);

  // Same pill (and same overlay) My Squads' own header uses — see
  // openSeriesSwitchOverlay, js/overlays.js.
  const newSeriesOptions = seriesList.filter(s=> s.id!==currentSeriesId && !mySquads.some(sq=>sq.seriesId===s.id));

  c.innerHTML = `
    <div class="flex-between" style="margin-bottom:18px;">
      <h2 class="home-greeting" style="margin-bottom:0;">Welcome back${myFirstName ? ', '+myFirstName : ''}</h2>
      ${switcherPillHtml('homeSeriesPillBtn', activeSeries ? activeSeries.name : 'this series', 'Switch series')}
    </div>

    <div class="scoreboard" id="homeScoreboardCard" title="Tap to see the full breakdown">
      <div class="sb-row">
        <div class="sb-team">${mySquad.teamName}</div>
        <div class="sb-score">${myTotal}</div>
      </div>
      <div class="sb-sep"></div>
      <div class="sb-row">
        <div class="sb-team" style="font-size:13px; color:var(--parchment-dim); font-family:var(--font-mono); font-weight:400;">${testsScored ? `${testsScored} Test${testsScored===1?'':'s'} scored` : 'No Tests locked yet'}</div>
        ${nextFixture ? `<div class="sb-score" style="font-size:13px; color:var(--parchment-dim); font-family:var(--font-mono); font-weight:400;">Test ${nextFixture.test} locks ${new Date(nextFixture.deadline).toLocaleDateString(undefined,{month:'short', day:'numeric'})}</div>` : ''}
      </div>
      ${mySquad.captain ? `
        <div class="sb-meta">
          <span><span class="cap">C</span> ${getPlayer(mySquad.captain).name}</span>
          ${mySquad.viceCaptain ? `<span>VC ${getPlayer(mySquad.viceCaptain).name}</span>` : ''}
        </div>
      ` : ''}
    </div>

    <h3 style="font-family:var(--font-display); margin:0 0 10px;">Your leagues</h3>
    ${leaguesHere.length===0
      ? `<div class="card"><div class="empty-state" style="padding:26px 20px;"><div class="big">Not in a league yet</div>Join or create one to compare your team against friends.<div style="margin-top:14px;"><button class="btn secondary small" id="homeJoinLeagueBtn">Go to My Leagues</button></div></div></div>`
      : `<div class="card">${standings.length===0
          ? `<div class="empty-state" style="padding:20px;">Standings show up here once at least one Test has locked.</div>`
          : standings.map(s=>`
            <div class="player-row standing-row" data-lid="${s.league.id}">
              <div class="player-name-wrap">
                <span class="standing-rank">${s.rank}</span>
                <span class="player-name">${s.league.name}</span>
              </div>
              <span class="standing-points">${s.points} pts &middot; ${s.rank}/${s.outOf}</span>
            </div>
          `).join('')}
        </div>`}

    <h3 style="font-family:var(--font-display); margin:24px 0 10px;">Series highlights</h3>
    <div class="card home-summary-card" id="homeRankingsCard">
      <div class="home-summary-head">
        <span class="home-summary-title">Player rankings</span>
        <span class="home-summary-cta">View all &rarr;</span>
      </div>
      ${topRanked.length===0
        ? `<div class="empty-state" style="padding:6px 0 0;">No points scored yet.</div>`
        : topRanked.map((row,i)=>`
          <div class="player-row standing-row">
            <div class="player-name-wrap">
              <span class="standing-rank">${i+1}</span>
              <span class="player-name">${row.p.name}</span>
              <span class="nat-pill">${row.p.nat}</span>
            </div>
            <span class="standing-points">${row.total} pts</span>
          </div>
        `).join('')}
    </div>

    <div class="card home-summary-card" id="homeTotCard" style="margin-top:16px;">
      <div class="home-summary-head">
        <span class="home-summary-title">Team of the Test</span>
        <span class="home-summary-cta">${totPreview.test ? `Test ${totPreview.test} &middot; View XI &rarr;` : 'View &rarr;'}</span>
      </div>
      ${totPreview.xi.length===0
        ? `<div class="empty-state" style="padding:6px 0 0;">No stats entered yet.</div>`
        : totPreview.xi.map((row,i)=>`
          <div class="player-row standing-row">
            <div class="player-name-wrap">
              <span class="standing-rank">${i+1}</span>
              <span class="player-name">${row.name}</span>
              <span class="nat-pill">${row.nat}</span>
            </div>
            <span class="standing-points">${row.points} pts</span>
          </div>
        `).join('')}
    </div>
  `;

  document.getElementById('homeSeriesPillBtn').addEventListener('click', ()=> openSeriesSwitchOverlay(newSeriesOptions));
  document.getElementById('homeScoreboardCard').addEventListener('click', ()=>{
    openTeamBreakdownOverlay(myBreakdownRow, PLAYER_MAP, id=> getPlayer(id).name);
  });
  const joinBtn = document.getElementById('homeJoinLeagueBtn');
  if(joinBtn) joinBtn.addEventListener('click', ()=> switchTab('leaderboard'));
  c.querySelectorAll('[data-lid]').forEach(row=>{
    row.addEventListener('click', ()=>{
      switchToLeague(row.dataset.lid);
      switchTab('leaderboard');
    });
  });
  document.getElementById('homeRankingsCard').addEventListener('click', ()=> openPlayerRankingsOverlay(PLAYERS, seriesPlayerTotals));
  document.getElementById('homeTotCard').addEventListener('click', ()=> openTeamOfTestOverlay(PLAYERS, homeFixtures, matchDataByTest));
}
