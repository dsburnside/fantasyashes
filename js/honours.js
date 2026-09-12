/* js/honours.js — the Honours tab: past series, archived, ranked by every squad's final total, plus your own leagues' full historical standings on each one. */

/* Every squad on a series, regardless of league membership — only ever
   legal to fetch this broadly once that series is archived (see
   squads_select_member_or_admin, supabase-schema.sql, which is what
   actually opens this up server-side; this function doesn't itself check
   `archived`, it just relies on RLS to refuse the read otherwise). The
   overall board ranks the WHOLE series' field for one winner, not any one
   league's standings, so it needs every squad, not just ones the viewer
   happens to share a league with. */
async function fetchSquadsForHonours(seriesId){
  const {data, error} = await supabaseClient.from('squads').select('*').eq('series_id', seriesId);
  if(error){ console.error(error); return []; }
  return (data||[]).map(rowToSquad);
}

/* Every squad on this (archived) series, ranked highest total first — same
   computeSquadTotal (js/home.js) a manager's own scoreboard already uses
   (adjustments and all), so a squad's honours-board total always matches
   what it showed while the series was still live. */
async function computeSeriesStandings(series, matchDataByTest){
  const squads = await fetchSquadsForHonours(series.id);
  return squads
    .map(sq=>({squad: sq, ...computeSquadTotal(sq, matchDataByTest)}))
    .sort((a,b)=> b.total - a.total || a.squad.teamName.localeCompare(b.squad.teamName));
}

/* This user's own league(s) on one archived series (myLeagues, js/data.js,
   already carries every league they're in regardless of series/archived
   status — no extra fetch needed to find them), each rendered with its full
   standings and, on tap, the exact same per-Test team-selection/scoring
   breakdown (openTeamBreakdownOverlay) My Leagues itself opens for a live
   league — same buildStandingRows (js/leagues.js) too, so an archived
   league's numbers are computed the identical way a current one's are.
   Renders nothing (leaves wrap empty) if the user wasn't in any league on
   this series — most viewers of an archived series they didn't play in. */
async function renderMyLeaguesOnSeries(series, matchDataByTest, wrap){
  const leaguesHere = myLeagues.filter(l=>l.seriesId===series.id);
  if(leaguesHere.length===0){ wrap.innerHTML=''; return; }

  const leaguePlayers = await fetchPlayers(series.id);
  const leaguePlayerMap = Object.fromEntries(leaguePlayers.map(p=>[p.id,p]));
  const leaguePlayerName = id => (leaguePlayerMap[id] && leaguePlayerMap[id].name) || '(removed player)';

  // Membership + squads fetched per league, same two-step shape
  // renderLeaderboard() (js/leagues.js) uses — squads no longer belong to a
  // single league, so a league's own standings need its membership list
  // first, then only the matching squads.
  const sections = [];
  for(const league of leaguesHere){
    const {data: memberRows, error: memberErr} = await supabaseClient.from('league_members').select('user_id').eq('league_id', league.id);
    const memberIds = memberErr ? [] : (memberRows||[]).map(m=>m.user_id);
    let squadRows = [];
    if(!memberErr && memberIds.length>0){
      const {data, error} = await supabaseClient.from('squads').select('*').eq('series_id', series.id).in('user_id', memberIds);
      if(!error) squadRows = data || [];
    }
    sections.push({league, rows: buildStandingRows(squadRows, matchDataByTest)});
  }
  if(!wrap.isConnected) return; // tab switched away (or re-rendered) before this resolved

  wrap.innerHTML = sections.map(({league, rows})=>`
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--line);">
      <h4 style="margin:0 0 8px; font-family:var(--font-display); font-size:15px;">${league.name}</h4>
      ${rows.length===0 ? '<p class="muted-on-light" style="font-size:12px; margin:0;">No teams in this league.</p>' : rows.map((r,i)=>`
        <div class="player-row standing-row" data-league="${league.id}" data-idx="${i}" title="Tap for the full Test-by-Test team and scoring breakdown">
          <div class="player-name-wrap">
            <span class="standing-rank">${i+1}</span>
            <span class="player-name">${r.name}</span>
            ${r.managerName ? `<span class="muted-on-light" style="font-size:11px;">${r.managerName}</span>` : ''}
          </div>
          <span class="standing-points">${r.total} pts</span>
        </div>
      `).join('')}
    </div>
  `).join('');
  sections.forEach(({league, rows})=>{
    wrap.querySelectorAll(`[data-league="${league.id}"]`).forEach(row=>{
      row.addEventListener('click', ()=> openTeamBreakdownOverlay(rows[parseInt(row.dataset.idx)], leaguePlayerMap, leaguePlayerName));
    });
  });
}

async function renderHonours(){
  const c = document.getElementById('honoursContent');
  if(!c) return;
  // series_select_all (supabase-schema.sql) is open to everyone, signed in
  // or not, so seriesList already carries every archived series regardless
  // of who's looking — no separate fetch needed, unlike the standings
  // themselves below.
  const archived = [...seriesList].filter(s=>s.archived)
    .sort((a,b)=> new Date(b.archived_at||b.created_at) - new Date(a.archived_at||a.created_at));

  // Browsable without an account, same as Rules — a finished series' squads
  // are readable by anyone once archived (squads_select_member_or_admin,
  // supabase-schema.sql), not just signed-in players. The "your leagues"
  // section further down just stays empty for a logged-out visitor (or
  // anyone who wasn't in a league on that series), since myLeagues is only
  // ever populated for the signed-in user.
  if(archived.length===0){
    c.innerHTML = `
      <h2 class="panel-title">Honours</h2>
      <div class="empty-state">No series archived yet — past champions show up here once a finished series is archived under Admin Hub.</div>
    `;
    return;
  }

  c.innerHTML = `
    <div class="flex-between" style="margin-bottom:14px;">
      <h2 class="panel-title" style="margin-bottom:0;">Honours <button type="button" class="help-icon" id="honoursHelpBtn" title="What's this?" aria-label="Help">?</button></h2>
    </div>
    ${archived.map(s=>`
      <div class="card" style="margin-bottom:14px;">
        <h3 style="margin:0 0 2px; font-family:var(--font-display);">${s.name}</h3>
        <p class="muted-on-light" style="font-size:11px; margin:0 0 10px;">${s.archived_at ? 'Archived '+new Date(s.archived_at).toLocaleDateString(undefined,{year:'numeric', month:'short', day:'numeric'}) : ''}</p>
        <div id="honoursStandings-${s.id}"><div class="empty-state" style="padding:14px;">Loading…</div></div>
        <div id="honoursMyLeagues-${s.id}"></div>
      </div>
    `).join('')}
  `;
  document.getElementById('honoursHelpBtn').addEventListener('click', ()=> showAlert("A finished series' final table, once an admin's archived it — ranked by every squad's total points across the whole series, regardless of which league (if any) they played in. If you were in a league on that series yourself, it's shown underneath with the same tap-for-the-full-breakdown standings My Leagues gives a live one. Archiving retires a series from My XI/My Leagues' everyday pickers; nothing about it is deleted, it just moves here.", 'Honours'));

  // Each series' standings are fetched independently so one slow one doesn't
  // hold up the others — they fill in their own card as soon as they resolve.
  archived.forEach(async series=>{
    const standingsWrap = document.getElementById(`honoursStandings-${series.id}`);
    const myLeaguesWrap = document.getElementById(`honoursMyLeagues-${series.id}`);
    if(!standingsWrap) return;

    const fx = await fetchFixtures(series.id);
    const matchDataByTest = {};
    for(const f of fx){
      matchDataByTest[f.test] = await getMatchDataForTest(series.id, f.test);
    }

    const rows = await computeSeriesStandings(series, matchDataByTest);
    if(!standingsWrap.isConnected) return; // tab switched away before this resolved
    if(rows.length===0){
      standingsWrap.innerHTML = `<div class="empty-state" style="padding:14px;">No squads were built for this series.</div>`;
    } else {
      // The #1 finisher gets the same star squad cards use for Captain
      // (.honours-star) — everyone else a plain rank number, same idea as
      // every other standings list in the app (leagues.js/home.js).
      standingsWrap.innerHTML = `
        ${rows.slice(0,3).map((r,i)=>`
          <div class="player-row standing-row">
            <div class="player-name-wrap">
              <span class="standing-rank">${i===0 ? '<span class="honours-star" title="Winner">&#9733;</span>' : i+1}</span>
              <span class="player-name">${r.squad.teamName}</span>
              ${r.squad.managerName ? `<span class="muted-on-light" style="font-size:11px;">${r.squad.managerName}</span>` : ''}
            </div>
            <span class="standing-points">${r.total} pts</span>
          </div>
        `).join('')}
        ${rows.length>3 ? `<p class="muted-on-light" style="font-size:11px; margin:8px 0 0;">${rows.length} squads competed.</p>` : ''}
      `;
    }

    if(session && myLeaguesWrap) await renderMyLeaguesOnSeries(series, matchDataByTest, myLeaguesWrap);
  });
}
