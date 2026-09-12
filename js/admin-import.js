/* js/admin-import.js — Admin Hub: import a Test's Playing XI/stats from a BBC Sport scorecard URL, in place of typing every figure by hand.
   The actual fetch happens server-side (see supabase/functions/import-bbc-scorecard) — BBC Sport isn't reachable directly from browser JS
   (cross-origin), and unlike Cricinfo (which blocks automated requests outright, browser or not) it fetches cleanly from a server. This file
   only ever writes into the SAME drafts (currentPlayingXiDraft/currentInningsDraft/currentStatsDraft, js/admin-match.js) the manual Scoring
   screen edits — nothing reaches the database until the admin reviews the pre-filled screen and hits the existing Save buttons themselves. */

async function fetchBbcScorecard(url){
  const {data, error} = await supabaseClient.functions.invoke('import-bbc-scorecard', {body: {url}});
  if(error){
    // supabase-js only gives a generic "Edge Function returned a non-2xx
    // status code" for our own error responses — the function's actual
    // {error: "..."} JSON body is what has the useful message, so dig it
    // out of the failed response if it's there rather than showing that.
    let detail = error.message;
    try{ const body = await error.context.json(); if(body && body.error) detail = body.error; }catch{}
    throw new Error(detail);
  }
  if(data && data.error) throw new Error(data.error);
  if(!data || !data.scorecard) throw new Error("Got a response but no scorecard data back — try again, or check the URL.");
  return data.scorecard;
}

// Diacritic-insensitive, punctuation-stripped lowercase compare — cheap but
// enough for matching BBC's naming against this app's players table without
// tripping over apostrophes/accents that don't matter for identity.
function normalizePlayerName(n){
  return (n||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
}
// Matches a BBC-supplied name against this series' player pool (adminPlayers,
// js/admin-match.js), scoped to one nation so "Smith" can't cross-match
// between teams. Three tries, each only accepted when it lands on exactly
// one player — an ambiguous one (two teammates both plausible) is left
// unmatched rather than guessed at:
//   1. Exact full-name match (BBC's `fullName` fields already read like
//      "Ollie Robinson", the same shape players.name uses).
//   2. Same surname (last word) — handles BBC's short/initialed forms
//      ("OE Robinson", "Robinson") against a full name, and — verified
//      against a real scraped Test — a differently-spelled FIRST name
//      elsewhere in the full name ("Mohammad Imran Randhawa" vs this app's
//      "Mohammed Imran Randhawa") without that spelling difference costing
//      the match, since it's the surname alone deciding it here.
//   3. Only once #2 finds no surname match at all: any other shared word.
//      Needed because a dismissal's fielder is sometimes given by first
//      name rather than surname ("Ghazi" for Ghazi Ghori, "Shan" for Shan
//      Masood) — kept as a last resort, and only reached when there's no
//      surname to go on, because matching on ANY shared word up front
//      turned out to false-match on common first names ("Mohammad") shared
//      by several unrelated teammates.
function matchImportedPlayer(name, nat){
  const norm = normalizePlayerName(name);
  if(!norm) return null;
  const pool = adminPlayers.filter(p=>p.nat===nat);
  const exact = pool.find(p=>normalizePlayerName(p.name)===norm);
  if(exact) return exact;

  const words = norm.split(' ');
  const surname = words[words.length-1];
  const bySurname = pool.filter(p=>{
    const nameWords = normalizePlayerName(p.name).split(' ');
    return nameWords[nameWords.length-1]===surname;
  });
  if(bySurname.length>0) return bySurname.length===1 ? bySurname[0] : null;

  const byAnyWord = pool.filter(p=>{
    const nameWords = normalizePlayerName(p.name).split(' ');
    return words.some(w=>nameWords.includes(w));
  });
  return byAnyWord.length===1 ? byAnyWord[0] : null;
}

/* Maps one BBC cricket-scorecard payload (see the Edge Function for its
   shape) onto this Test's drafts, exactly as if every field had been typed
   into Player Selection/Scoring by hand — same currentPlayingXiDraft/
   currentInningsDraft/currentStatsDraft the rest of admin-match.js reads
   and saves. Returns the list of BBC names that couldn't be matched to a
   player in this series' pool, so the caller can flag them for a manual
   look rather than silently dropping their stats. */
function applyBbcImport(scorecard){
  const unmatched = [];
  const noteUnmatched = (name, nat, role)=> unmatched.push(`${name} (${nat}${role?', '+role:''})`);

  const teamNatFor = teamId=>{
    if(scorecard.homeTeam.id===teamId) return scorecard.homeTeam.name.shortName;
    if(scorecard.awayTeam.id===teamId) return scorecard.awayTeam.name.shortName;
    return null;
  };
  const otherNat = nat => nat===scorecard.homeTeam.name.shortName ? scorecard.awayTeam.name.shortName : scorecard.homeTeam.name.shortName;

  // Playing XI — BBC's starters list is already in batting order, which is
  // exactly the order Player Selection needs it added in (see
  // renderPlayingXiTable's own comment, js/admin-match.js) for Scoring to
  // read the same order afterward.
  const xiPids = [];
  const keeperPidByNat = {};
  [scorecard.homeTeam, scorecard.awayTeam].forEach(team=>{
    const nat = team.name.shortName;
    team.players.starters.forEach(sp=>{
      const p = matchImportedPlayer(sp.displayName, nat);
      if(p){
        xiPids.push(p.id);
        if(sp.isWicketKeeper) keeperPidByNat[nat] = p.id;
      } else {
        noteUnmatched(sp.displayName, nat);
      }
    });
  });

  // Innings, stats and per-innings keeper — scorecard.innings is already in
  // play order, so counting each team's own appearances in it gives the
  // same per-team-relative inn1/inn2 numbering buildInningsPanel expects
  // (see its own comment, js/admin-match.js, on why it's per-team not
  // global). keeperPidByNat (from isWicketKeeper above) auto-fills
  // entry.keeper — the same "who actually had the gloves" signal the admin
  // would otherwise pick by hand (resolveKeeperForEntry, js/scoring.js),
  // now read straight from BBC's own squad data instead of inferred.
  const teamInnCount = {};
  const newInnings = [];
  const newStats = {};
  const statsFor = pid=> (newStats[pid] || (newStats[pid] = {}));

  (scorecard.innings||[]).forEach(inn=>{
    const battingNat = teamNatFor(inn.battingTeamId);
    if(!battingNat) return;
    const bowlingNat = otherNat(battingNat);
    teamInnCount[battingNat] = (teamInnCount[battingNat]||0) + 1;
    const innNum = teamInnCount[battingNat];
    const innKey = 'inn'+innNum;

    // A stumping can only ever be the keeper's doing, cricket's laws
    // guarantee it — so if this specific innings has one, its fielder is a
    // more reliable "who actually had the gloves" answer for THIS innings
    // than the match-wide isWicketKeeper flag above, which only reflects
    // each squad's nominal keeper and doesn't notice a mid-Test swap (that's
    // exactly what happened in the real Test this was tested against: Cox
    // stood in for Smith for one England innings, undetected by that flag,
    // caught correctly here because of his stumping).
    const stumping = (inn.batting||[]).find(b=>b.isOut && b.dismissalType==='stumped' && b.dismissalFielder && !b.dismissalFielder.isSub);
    const stumperPid = stumping ? (matchImportedPlayer(stumping.dismissalFielder.playerNameShort, bowlingNat)||{}).id : null;

    newInnings.push({
      battingCode: battingNat,
      inn: innNum,
      byes: parseInt((inn.extras||{}).byes, 10) || 0,
      keeper: stumperPid || keeperPidByNat[bowlingNat] || null,
    });

    (inn.batting||[]).forEach(b=>{
      if(!b.batted) return;

      // Credited independently of whether the dismissed batter themselves
      // matches below — a name clash on one side (e.g. a spelling mismatch
      // against this app's own player record) has nothing to do with
      // whether the FIELDER's name resolves, and skipping this whenever the
      // batter didn't match silently lost real catches/stumpings/run-outs
      // that BBC still reported cleanly. A substitute fielder
      // (dismissalFielder.isSub) isn't a member of either Playing XI and
      // was never going to be creditable here — not a match failure to
      // flag, just nothing to do.
      if(b.isOut && b.dismissalFielder && !b.dismissalFielder.isSub && (b.dismissalType==='caught' || b.dismissalType==='stumped' || b.dismissalType==='run out')){
        const fielderName = b.dismissalFielder.playerNameShort;
        const fp = matchImportedPlayer(fielderName, bowlingNat);
        if(fp){
          const fs = statsFor(fp.id)[innKey] = statsFor(fp.id)[innKey] || {};
          if(b.dismissalType==='caught') fs.catches = (fs.catches||0) + 1;
          else if(b.dismissalType==='stumped') fs.stumpings = (fs.stumpings||0) + 1;
          else fs.runouts = (fs.runouts||0) + 1;
        } else {
          noteUnmatched(fielderName, bowlingNat, 'fielding');
        }
      }

      const p = matchImportedPlayer(b.fullName || b.playerName, battingNat);
      if(!p){ noteUnmatched(b.fullName || b.playerName, battingNat, 'batting'); return; }
      const runs = parseInt(b.runs, 10) || 0;
      const s = statsFor(p.id)[innKey] = statsFor(p.id)[innKey] || {};
      s.runs = runs;
      s.ballsFaced = parseInt(b.balls, 10) || 0;
      // A duck is being DISMISSED for zero, not just finishing an innings on
      // zero — stranded not out (last batter at the end of an innings, say)
      // doesn't count. The manual-entry Runs field can only auto-tick on
      // runs===0 alone (admin-match.js) since there's no isOut field in that
      // form to check — a deliberate simplification, correctable by hand —
      // but BBC's data actually says whether they were out, so the importer
      // has no excuse not to use it.
      s.duck = runs===0 && !!b.isOut;
      s.hundred = runs>=100;
      s.fifty = runs>=50 && runs<100;
    });

    (inn.bowling||[]).forEach(bw=>{
      const p = matchImportedPlayer(bw.fullName || bw.playerName, bowlingNat);
      if(!p){ noteUnmatched(bw.fullName || bw.playerName, bowlingNat, 'bowling'); return; }
      const wkts = parseInt(bw.wickets, 10) || 0;
      const s = statsFor(p.id)[innKey] = statsFor(p.id)[innKey] || {};
      s.overs = parseFloat(bw.overs) || 0; // BBC already writes cricket notation (e.g. "11.3"), same as this app's own overs fields
      s.runsConceded = parseInt(bw.runsConceded, 10) || 0;
      s.wickets = wkts;
      s.fiveWkt = wkts>=5;
      s.fourWkt = wkts===4;
      s.wides = parseInt(bw.wides, 10) || 0;
      s.noBalls = parseInt(bw.noBalls, 10) || 0;
    });
  });

  currentPlayingXiDraft = xiPids;
  currentInningsDraft = newInnings;
  currentStatsDraft = newStats;
  activeInningsIdx = 0;

  // The same unresolved name can turn up once per innings/role it appears
  // in (batting, bowling, fielding) — deduped here rather than at each call
  // site, so the review alert names each problem player once, not 3-4 times.
  return {unmatched: [...new Set(unmatched)]};
}

function openBbcImportOverlay(){
  const backdrop = openOverlay(`
    <div class="overlay-title">Import from BBC Sport</div>
    <div class="overlay-message">Paste this Test's BBC Sport scorecard URL (bbc.co.uk/sport/cricket/scorecard/&hellip;) — fills in Player Selection and Scoring from it, but changes nothing here until you review the result and hit Save yourself.</div>
    <div class="field-group"><label for="bbcImportUrl">Scorecard URL</label><input type="text" id="bbcImportUrl" placeholder="https://www.bbc.co.uk/sport/cricket/scorecard/e-..."></div>
    <div class="auth-error" id="bbcImportError"></div>
    <div class="overlay-actions"><button class="btn" id="bbcImportGoBtn">Import</button></div>
  `);
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  const errBox = backdrop.querySelector('#bbcImportError');
  const goBtn = backdrop.querySelector('#bbcImportGoBtn');
  goBtn.addEventListener('click', async ()=>{
    const url = backdrop.querySelector('#bbcImportUrl').value.trim();
    if(!url){ errBox.textContent = 'Paste a scorecard URL first.'; return; }
    errBox.textContent = '';
    goBtn.disabled = true;
    goBtn.textContent = 'Importing…';
    try{
      const scorecard = await fetchBbcScorecard(url);
      const {unmatched} = applyBbcImport(scorecard);
      closeOverlay();
      adminScreen = 'scoring';
      renderAdminHub();
      if(unmatched.length){
        showAlert(`Imported — but ${unmatched.length} name${unmatched.length===1?'':'s'} from BBC couldn't be matched to a player in this series' pool, so their stats weren't included. Check Player Selection and Scoring against the scorecard for:<br><br>${unmatched.map(n=>`&bull; ${n}`).join('<br>')}`, 'Check these before saving');
      } else {
        showAlert("Imported — Player Selection and Scoring are filled in below. Review them against the scorecard, then Save Playing XI and Save Stats as usual.", 'Imported');
      }
    }catch(e){
      errBox.textContent = e.message || String(e);
    }finally{
      goBtn.disabled = false;
      goBtn.textContent = 'Import';
    }
  });
}
