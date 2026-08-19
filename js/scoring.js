/* js/scoring.js — pure squad/scoring logic: point calculation, squad validation, squad<->DB row mapping. No DOM, no network. */
/* ================= SCORING ================= */
// Bowling overs are entered in cricket notation (e.g. 4.3 meaning 4 overs
// and 3 balls, i.e. 4 overs 3 balls into the 5th — never .6, since a 6th
// ball completes the over and becomes the next whole number instead), not a
// decimal fraction of an over — this converts that into true (fractional)
// overs (4.5 here) so economy math divides by the right amount.
function trueOvers(overs){
  if(!overs) return 0;
  const whole = Math.floor(overs);
  const balls = Math.round((overs - whole) * 10);
  return whole + balls/6;
}
// Runs conceded per true over for one innings — null (not 0) if no overs are
// recorded yet, so "bowled 0 overs" never accidentally reads as a sub-3.5
// economy bonus.
function economyFor(inn){
  if(!inn) return null;
  const ov = trueOvers(inn.overs);
  if(!ov) return null;
  return (inn.runsConceded||0) / ov;
}
// True overs across both innings of a Test, for a per-Test economy DISPLAY
// (not the scoring bonus itself, which is checked per-innings inside
// singleInningsPoints — a player who qualifies in one innings but not the
// other still gets that innings' bonus regardless of their combined figure).
// Sums the true-overs conversion of each innings rather than the raw
// cricket-notation numbers themselves (4.3 + 4.4 isn't 8.7 true overs).
function trueOversTotal(s){
  if(!s) return 0;
  if(s.inn1 || s.inn2) return trueOvers(s.inn1 && s.inn1.overs) + trueOvers(s.inn2 && s.inn2.overs);
  return trueOvers(s.overs);
}
// Combined economy across a Test's innings, for display — null if no overs
// recorded, same reasoning as economyFor().
function economyDisplayFor(s){
  const ov = trueOversTotal(s);
  if(!ov) return null;
  return statMetricTotal(s, 'runsConceded') / ov;
}
// `role` is the fantasy playing role assigned to this player in whichever
// squad is being scored (see defaultPlayingRole) — omit it (or pass a value
// that isn't BAT/BOWL/WK) to get the plain, undoubled rate, which is what the
// player-picker's raw series-points ranking uses. Doubling only ever applies
// to that role's own bonus: a Batter's 50/100/balls-faced bonus, a Bowler's
// 4-/5-fer/economy bonus, or a Wicketkeeper's catch/stumping/run-out points
// — everything else (runs, wickets, duck) is unaffected regardless of
// assigned role.
function singleInningsPoints(inn, role){
  if(!inn) return 0;
  let pts = 0;
  pts += (inn.runs||0) * 1;
  const batMult = role==='BAT' ? 2 : 1;
  const bowlMult = role==='BOWL' ? 2 : 1;
  const wkMult = role==='WK' ? 2 : 1;
  if(inn.hundred) pts += 16*batMult;
  else if(inn.fifty) pts += 8*batMult;
  if((inn.ballsFaced||0) > 50) pts += 20*batMult;
  if(inn.duck) pts -= 20;
  pts += (inn.wickets||0) * 20;
  if(inn.fiveWkt) pts += 16*bowlMult;
  else if(inn.fourWkt) pts += 8*bowlMult;
  const econ = economyFor(inn);
  if(econ !== null && econ < 3.5) pts += 20*bowlMult;
  pts += (inn.catches||0) * 8*wkMult;
  pts += (inn.stumpings||0) * 12*wkMult;
  pts += (inn.runouts||0) * 8*wkMult;
  return pts;
}
function statPoints(s, role){
  if(!s) return 0;
  // New shape: {inn1:{...}, inn2:{...}} — sum both, so e.g. a century in each
  // innings both earn the bonus. Falls back to treating s itself as a single
  // innings for stats saved before per-innings entry existed.
  if(s.inn1 || s.inn2){
    return singleInningsPoints(s.inn1, role) + singleInningsPoints(s.inn2, role);
  }
  return singleInningsPoints(s, role);
}
// Same rates as singleInningsPoints, but split into batting/bowling/fielding
// buckets and always at the plain (undoubled) rate — this feeds the player
// picker's "how has this player actually been performing" points display,
// which is about the player's own output, not any one manager's assigned
// playing role. bat+bowl+field always equals statPoints(s) with no role.
function inningsPointsBreakdown(inn){
  if(!inn) return {bat:0, bowl:0, field:0};
  let bat = (inn.runs||0) * 1;
  if(inn.hundred) bat += 16;
  else if(inn.fifty) bat += 8;
  if((inn.ballsFaced||0) > 50) bat += 20;
  if(inn.duck) bat -= 20;
  let bowl = (inn.wickets||0) * 20;
  if(inn.fiveWkt) bowl += 16;
  else if(inn.fourWkt) bowl += 8;
  const econ = economyFor(inn);
  if(econ !== null && econ < 3.5) bowl += 20;
  const field = (inn.catches||0)*8 + (inn.stumpings||0)*12 + (inn.runouts||0)*8;
  return {bat, bowl, field};
}
function statPointsBreakdown(s){
  if(!s) return {bat:0, bowl:0, field:0};
  const parts = (s.inn1 || s.inn2) ? [inningsPointsBreakdown(s.inn1), inningsPointsBreakdown(s.inn2)] : [inningsPointsBreakdown(s)];
  return parts.reduce((acc,p)=>({bat:acc.bat+p.bat, bowl:acc.bowl+p.bowl, field:acc.field+p.field}), {bat:0, bowl:0, field:0});
}
// Raw (non-points) total for one tracked stat — e.g. statMetricTotal(s,'runs')
// — summed across both innings the same way statPoints() sums points. Used
// wherever a breakdown needs the actual counting stat rather than what it's
// worth in points (the leaderboard's per-player team breakdown).
function statMetricTotal(s, key){
  if(!s) return 0;
  if(s.inn1 || s.inn2) return ((s.inn1&&s.inn1[key])||0) + ((s.inn2&&s.inn2[key])||0);
  return s[key]||0;
}
/* Works out who actually took the field for a locked XI once the real Playing XI
   is known. Anyone locked in who isn't on `playingXi` is treated as a non-player
   and replaced by their team's first bench player (in squad order) who is on
   `playingXi` — same idea as Fantasy Premier League's automatic substitutions.
   An empty/unset `playingXi` means "not announced yet", so nothing is subbed. */
function resolveEffectiveXi(lockedEntry, playingXi){
  const xi = lockedEntry.xi || [];
  const announced = Array.isArray(playingXi) && playingXi.length > 0;
  if(!announced){
    return {effectiveXi: xi.map(pid=>({pid, subFor:null})), captainDidNotPlay:false};
  }
  const played = new Set(playingXi);
  const benchQueue = [...(lockedEntry.bench||[])];
  const effectiveXi = xi.map(outPid=>{
    if(played.has(outPid)) return {pid:outPid, subFor:null};
    const idx = benchQueue.findIndex(bid=>played.has(bid));
    if(idx===-1) return {pid:null, subFor:outPid};
    return {pid: benchQueue.splice(idx,1)[0], subFor:outPid};
  });
  const captainDidNotPlay = !!lockedEntry.captain && !played.has(lockedEntry.captain);
  return {effectiveXi, captainDidNotPlay};
}
// One player's points for one Test, already carrying whatever multiplier
// applies to them personally (assigned playing role's bonus doubling, plus
// captain/vice-captain) — the shared building block behind computeTestScore
// (summed across the XI) and the leaderboard's per-player, per-Test team
// breakdown (kept per-player instead), so the two can never drift out of
// sync with each other.
// The Vice-Captain carries no bonus of their own — it only exists as backup
// for the Captain. If the captain didn't play (and was subbed off), the
// armband's 2x bonus passes to the vice-captain instead — but only if the
// VC actually played too; otherwise the bonus is simply lost, same as if
// neither had played.
function playerPointsForTest(lockedEntry, statsForTest, pid, captainDidNotPlay){
  const role = (lockedEntry.playingRoles && lockedEntry.playingRoles[pid]) || defaultPlayingRole(getPlayer(pid).role);
  let pts = statPoints(statsForTest ? statsForTest[pid] : null, role);
  if(pid === lockedEntry.captain && !captainDidNotPlay) pts *= 2;
  else if(pid === lockedEntry.viceCaptain && captainDidNotPlay) pts *= 2;
  return pts;
}
function computeTestScore(lockedEntry, statsForTest, playingXi){
  if(!lockedEntry) return 0;
  const {effectiveXi, captainDidNotPlay} = resolveEffectiveXi(lockedEntry, playingXi);
  let total = 0;
  effectiveXi.forEach(({pid})=>{
    if(!pid) return;
    total += playerPointsForTest(lockedEntry, statsForTest, pid, captainDidNotPlay);
  });
  return Math.round(total*10)/10;
}
/* The best legal XI for one Test, picked from the full player pool of both
   series teams (not any one manager's squad) purely on how they actually
   performed — plain undoubled points (statPoints with no role), same rate
   seriesPlayerTotals/the rankings lightbox already rank players by, since
   there's no fantasy manager here to have assigned anyone a playing role.
   "Legal" here means the one structural rule that applies to any XI in this
   game: exactly 11, including at least one wicketkeeper — unlike the 14-man
   squad rules, there's no 5-per-team requirement, since an all-star XI
   drawing from both teams isn't a manager's roster to keep balanced.
   Only players `stats` actually has an entry for are eligible (i.e. actually
   played that Test) — a non-participant defaulting to 0 points must never
   outrank a real performer who had a quiet game. Returns [] if nobody in
   `stats` has an entry yet. */
function computeTeamOfTest(players, stats){
  if(!stats) return [];
  const eligible = players
    .filter(p => stats[p.id] !== undefined)
    .map(p => ({p, pts: statPoints(stats[p.id])}))
    .sort((a,b)=> b.pts - a.pts);
  if(eligible.length===0) return [];
  let xi = eligible.slice(0, 11);
  if(xi.length===11 && !xi.some(x=>x.p.role==='WK')){
    const bestWk = eligible.find(x=> x.p.role==='WK' && !xi.includes(x));
    if(bestWk) xi = xi.slice(0, 10).concat([bestWk]);
  }
  xi.sort((a,b)=> b.pts - a.pts);
  return xi.map(({p, pts})=>{
    const s = stats[p.id];
    return {
      pid: p.id, name: p.name, nat: p.nat, role: p.role,
      points: Math.round(pts*10)/10,
      runs: statMetricTotal(s,'runs'), wickets: statMetricTotal(s,'wickets'),
      catches: statMetricTotal(s,'catches'), stumpings: statMetricTotal(s,'stumpings'), runouts: statMetricTotal(s,'runouts'),
      ballsFaced: statMetricTotal(s,'ballsFaced'), economy: economyDisplayFor(s),
    };
  });
}

/* ================= SQUAD ROW <-> JS MAPPING ================= */
function rowToSquad(row){
  if(!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    seriesId: row.series_id,
    teamName: row.team_name,
    managerName: row.manager_name,
    squad14: row.squad14 || [],
    xi11: row.xi11 || [],
    bench3: row.bench3 || [],
    captain: row.captain,
    viceCaptain: row.vice_captain,
    baselineSquad14: row.baseline_squad14 || [],
    wildcardUsed: row.wildcard_used,
    wildcardActiveNow: row.wildcard_active_now,
    wildcardCommittedPending: row.wildcard_committed_pending,
    lockedXiByTest: row.locked_xi_by_test || {},
    playingRoles: row.playing_roles || {},
  };
}
function squadToRow(squad){
  return {
    user_id: squad.userId,
    team_name: squad.teamName,
    manager_name: squad.managerName,
    squad14: squad.squad14,
    xi11: squad.xi11,
    bench3: squad.bench3,
    captain: squad.captain,
    vice_captain: squad.viceCaptain,
    baseline_squad14: squad.baselineSquad14,
    wildcard_used: squad.wildcardUsed,
    wildcard_active_now: squad.wildcardActiveNow,
    wildcard_committed_pending: squad.wildcardCommittedPending,
    locked_xi_by_test: squad.lockedXiByTest,
    playing_roles: squad.playingRoles || {},
  };
}

/* Count how many players differ between two same-length rosters. Since both
   are the same size, "players in A not in B" equals "players in B not in A" —
   that number is the number of transfers needed to turn one into the other. */
function countChanges(rosterA, rosterB){
  return rosterA.filter(id=>!rosterB.includes(id)).length;
}

/* Validates a 14-man squad against the league rules: exactly 14, at least 5
   from each of the series' two teams, at least one wicketkeeper. Used by both
   initial squad-building and ongoing transfers in My Squads. Teams are
   derived from the full available PLAYERS pool (not just the selection) so a
   team with zero players picked still gets flagged as short, rather than
   silently passing because it never appears among the chosen ids.
   The 5-per-team split is a rule about the 14-man squad (XI + bench
   together) — it's only checked once all 14 are picked, so it never fires
   against a still-being-built starting XI (e.g. filling XI slots before
   touching the bench, which is naturally lopsided until the bench is filled). */
function validateSquad14(ids){
  const poolNats = [...new Set(PLAYERS.map(p=>p.nat))];
  const counts = {};
  ids.forEach(id=>{ const n = getPlayer(id).nat; counts[n] = (counts[n]||0) + 1; });
  const wkCount = ids.filter(id=>getPlayer(id).role==='WK').length;
  const errors = [];
  if(ids.length!==14) errors.push(`Squad has ${ids.length}/14 players`);
  if(ids.length===14){
    poolNats.forEach(n=>{
      const c = counts[n] || 0;
      if(c < 5) errors.push(`Only ${c} ${teamNameForCode(n)} players (need 5+)`);
    });
  }
  if(wkCount<1) errors.push('No wicketkeeper in the squad');
  return {valid: errors.length===0, errors, counts, wkCount};
}

