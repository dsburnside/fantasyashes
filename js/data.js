/* js/data.js — all Supabase reads/writes: players, fixtures, squads, leagues, series/team/venue lookups. */
/* ================= DATA ACCESS ================= */
/* Players/fixtures both live per-series now. fetchPlayers/fetchFixtures are the
   raw loaders; loadPlayers/loadFixtures point the player-facing PLAYERS/fixtures
   globals at a series, while Admin's own tools keep a separate adminPlayers/
   adminFixtures copy (see ADMIN state) so editing a different series than the
   one you personally play in never clobbers your own My XI/Leaderboard view. */
async function fetchPlayers(seriesId){
  if(!seriesId) return [];
  const {data, error} = await supabaseClient.from('players').select('*').eq('series_id', seriesId).order('nat').order('name');
  if(error){ console.error(error); return []; }
  return data || [];
}
async function fetchFixtures(seriesId){
  if(!seriesId) return [];
  const {data, error} = await supabaseClient.from('fixtures').select('*').eq('series_id', seriesId).order('test');
  if(error){ console.error(error); return []; }
  return (data||[]).map(f=>({test:f.test, venue:f.venue, date:f.date, deadline: toDatetimeLocalValue(f.deadline), lockedAt: f.locked_at}));
}
async function loadPlayers(seriesId){
  PLAYERS = await fetchPlayers(seriesId);
  PLAYER_MAP = buildPlayerMap();
}
async function loadFixtures(seriesId){
  fixtures = await fetchFixtures(seriesId);
}
async function loadSeriesList(){
  // Two FKs from series to teams (team_a_id/team_b_id) need the constraint
  // name to disambiguate which is which — Postgres auto-names an inline
  // `references` added via ALTER TABLE ADD COLUMN as <table>_<column>_fkey.
  const {data, error} = await supabaseClient.from('series')
    .select('*, teamA:teams!series_team_a_id_fkey(id,name,short_code), teamB:teams!series_team_b_id_fkey(id,name,short_code)')
    .order('created_at');
  if(error){ console.error(error); return; }
  seriesList = data || [];
}
async function loadTeamsList(){
  const {data, error} = await supabaseClient.from('teams').select('*').order('name');
  if(error){ console.error(error); return; }
  teamsList = data || [];
}
async function loadVenuesList(){
  const {data, error} = await supabaseClient.from('venues').select('*').order('name');
  if(error){ console.error(error); return; }
  venuesList = data || [];
}
/* Resolves "the two teams" for a series — from its own team_a/team_b if set,
   falling back to whatever nat codes actually appear in a given player pool
   (only relevant for older data that predates the teams table). Returns up
   to two {id, name, short_code} objects. */
function resolveSeriesTeams(seriesId, playersPool){
  const s = seriesList.find(x=>x.id===seriesId);
  if(s && s.teamA && s.teamB) return [s.teamA, s.teamB];
  const codes = [...new Set((playersPool||[]).map(p=>p.nat))];
  return codes.map(code=>({id:null, name:code, short_code:code}));
}
function teamNameForCode(code){
  const t = teamsList.find(t=>t.short_code===code);
  return t ? t.name : code;
}
/* Loads every squad the signed-in user holds — one per series they've picked
   a team for, entirely independent of league membership — and resolves
   which one My XI is currently showing: whatever's still valid from before,
   else what's saved in localStorage, else their first team, else null (no
   team picked yet). */
async function loadMySquads(){
  if(!session){ mySquads = []; mySquad = null; currentSeriesId = null; return; }
  const {data, error} = await supabaseClient.from('squads').select('*').eq('user_id', session.user.id);
  if(error){ console.error(error); mySquads = []; mySquad = null; return; }
  mySquads = (data||[]).map(rowToSquad);
  const stored = localStorage.getItem('currentSeriesId');
  if(!(currentSeriesId && mySquads.some(s=>s.seriesId===currentSeriesId))){
    currentSeriesId = (stored && mySquads.some(s=>s.seriesId===stored)) ? stored : (mySquads[0] ? mySquads[0].seriesId : null);
  }
  if(currentSeriesId) localStorage.setItem('currentSeriesId', currentSeriesId);
  mySquad = mySquads.find(s=>s.seriesId===currentSeriesId) || null;
}
/* Loads every league the signed-in user belongs to (via league_members —
   entirely separate from mySquads/series, since a league is just an
   optional leaderboard grouping, not a prerequisite for picking a team),
   and resolves which one the My Leagues tab is currently showing standings
   for, the same "keep valid, else localStorage, else first, else none" way
   loadMySquads() resolves currentSeriesId. */
async function loadMyLeagues(){
  if(!session){ myLeagues = []; currentLeagueId = null; return; }
  const {data, error} = await supabaseClient.from('league_members').select('league_id, leagues(id, name, series_id, join_code, created_by, created_by_name)').eq('user_id', session.user.id);
  if(error){ console.error(error); myLeagues = []; return; }
  myLeagues = (data||[]).filter(m=>m.leagues).map(m=>({id:m.leagues.id, name:m.leagues.name, seriesId:m.leagues.series_id, joinCode:m.leagues.join_code, createdBy:m.leagues.created_by, createdByName:m.leagues.created_by_name}));
  const stored = localStorage.getItem('currentLeagueId');
  if(!(currentLeagueId && myLeagues.some(l=>l.id===currentLeagueId))){
    currentLeagueId = (stored && myLeagues.some(l=>l.id===stored)) ? stored : (myLeagues[0] ? myLeagues[0].id : null);
  }
  if(currentLeagueId) localStorage.setItem('currentLeagueId', currentLeagueId);
}
async function saveMySquad(){
  if(!mySquad) return;
  const {error} = await supabaseClient.from('squads').update(squadToRow(mySquad)).eq('user_id', session.user.id).eq('series_id', mySquad.seriesId);
  if(error){ showAlert('Could not save: '+error.message); console.error(error); }
}
async function getMatchDataForTest(seriesId, testNum){
  const {data, error} = await supabaseClient.from('match_stats').select('stats, playing_xi, innings').eq('series_id', seriesId).eq('test', testNum).maybeSingle();
  if(error){ console.error(error); return {stats:{}, playingXi:[], innings:[]}; }
  return {stats: (data && data.stats) || {}, playingXi: (data && data.playing_xi) || [], innings: (data && data.innings) || []};
}

// pid -> {bat, bowl, field, total, runs, wickets, catches, stumpings,
// runouts} scored across every Test entered so far this series. bat/bowl/
// field/total are points (plain rate, no captain/VC/playing-role multiplier
// — it's a ranking of the player's own output, not any one manager's
// fantasy score); runs/wickets/catches/stumpings/runouts are the raw
// counting stats behind those points, same idea as leagues.js's per-Test
// breakdown rows but summed across the whole series — what My XI's player
// detail overlay (js/overlays.js) shows. Starts at all-zero for everyone at
// the start of a series since there's simply nothing in match_stats yet.
// Drives the player picker's per-role sort order and its bat/bowl/field
// points display.
let seriesPlayerTotals = {};
async function loadSeriesPlayerTotals(seriesId){
  seriesPlayerTotals = {};
  if(!seriesId) return;
  const fx = await fetchFixtures(seriesId);
  const perTest = await Promise.all(fx.map(f=>getMatchDataForTest(seriesId, f.test)));
  perTest.forEach(({stats})=>{
    Object.keys(stats||{}).forEach(pid=>{
      const s = stats[pid];
      const b = statPointsBreakdown(s);
      const cur = seriesPlayerTotals[pid] || {bat:0, bowl:0, field:0, total:0, runs:0, wickets:0, catches:0, stumpings:0, runouts:0};
      seriesPlayerTotals[pid] = {
        bat: cur.bat + b.bat,
        bowl: cur.bowl + b.bowl,
        field: cur.field + b.field,
        total: cur.total + b.bat + b.bowl + b.field,
        runs: cur.runs + statMetricTotal(s,'runs'),
        wickets: cur.wickets + statMetricTotal(s,'wickets'),
        catches: cur.catches + statMetricTotal(s,'catches'),
        stumpings: cur.stumpings + statMetricTotal(s,'stumpings'),
        runouts: cur.runouts + statMetricTotal(s,'runouts'),
      };
    });
  });
}

/* Switches which series My XI is building/showing a team for — points the
   player-facing PLAYERS/fixtures at it and resets any in-progress draft,
   since it belonged to the previous series' squad. Also lands the Squad
   page back on its Select Team sub-tab rather than leaving it on Points,
   which is about to repaint with a different squad's data. */
async function switchToSeries(seriesId){
  currentSeriesId = seriesId;
  localStorage.setItem('currentSeriesId', seriesId);
  mySquad = mySquads.find(s=>s.seriesId===seriesId) || null;
  draft = null;
  myxiSubtab = 'select';
  await Promise.all([loadPlayers(seriesId), loadFixtures(seriesId), loadSeriesPlayerTotals(seriesId)]);
  renderMyXI();
  renderHome(); // Home's snapshot/summary cards are also scoped to currentSeriesId — see its own series tab strip
  renderCountdown();
}
/* Switches which league the My Leagues tab shows standings for. Unlike
   switchToSeries, this doesn't touch PLAYERS/fixtures/draft — renderLeaderboard()
   fetches its own players/fixtures for the selected league's series, since
   that can be a different series entirely from whatever My XI has open. */
function switchToLeague(leagueId){
  currentLeagueId = leagueId;
  localStorage.setItem('currentLeagueId', leagueId);
  renderLeaderboard();
}

