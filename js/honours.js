/* js/honours.js — the Honours tab: past champions, one archived series at a time. */

/* Every squad on a series, regardless of league membership — only ever
   legal to fetch this broadly once that series is archived (see
   squads_select_member_or_admin, supabase-schema.sql, which is what
   actually opens this up server-side; this function doesn't itself check
   `archived`, it just relies on RLS to refuse the read otherwise). The
   honours board ranks the WHOLE series' field for one overall winner, not
   any one league's standings, so it needs every squad, not just ones the
   viewer happens to share a league with. */
async function fetchSquadsForHonours(seriesId){
  const {data, error} = await supabaseClient.from('squads').select('*').eq('series_id', seriesId);
  if(error){ console.error(error); return []; }
  return (data||[]).map(rowToSquad);
}

/* Every squad on this (archived) series, ranked highest total first — same
   computeSquadTotal (js/home.js) a manager's own scoreboard already uses
   (adjustments and all), so a squad's honours-board total always matches
   what it showed while the series was still live. */
async function computeSeriesStandings(series){
  const fx = await fetchFixtures(series.id);
  const matchDataByTest = {};
  for(const f of fx){
    matchDataByTest[f.test] = await getMatchDataForTest(series.id, f.test);
  }
  const squads = await fetchSquadsForHonours(series.id);
  return squads
    .map(sq=>({squad: sq, ...computeSquadTotal(sq, matchDataByTest)}))
    .sort((a,b)=> b.total - a.total || a.squad.teamName.localeCompare(b.squad.teamName));
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
  // supabase-schema.sql), not just signed-in players.
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
      </div>
    `).join('')}
  `;
  document.getElementById('honoursHelpBtn').addEventListener('click', ()=> showAlert("A finished series' final table, once an admin's archived it — ranked by every squad's total points across the whole series, regardless of which league (if any) they played in. Archiving retires a series from My XI/My Leagues' everyday pickers; nothing about it is deleted, it just moves here.", 'Honours'));

  // Each series' standings are fetched independently so one slow one doesn't
  // hold up the others — they fill in their own card as soon as they resolve.
  archived.forEach(async series=>{
    const wrap = document.getElementById(`honoursStandings-${series.id}`);
    if(!wrap) return;
    const rows = await computeSeriesStandings(series);
    if(!wrap.isConnected) return; // tab switched away (or re-rendered) before this resolved
    if(rows.length===0){
      wrap.innerHTML = `<div class="empty-state" style="padding:14px;">No squads were built for this series.</div>`;
      return;
    }
    // The #1 finisher gets the same star squad cards use for Captain
    // (.honours-star) — everyone else a plain rank number, same idea as
    // every other standings list in the app (leagues.js/home.js).
    wrap.innerHTML = `
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
  });
}
