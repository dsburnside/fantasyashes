/* js/myxi.js — the My XI tab: squad building, Sub/Transfer swaps, captain/VC/playing-role assignment, commit flow. */
/* ================= MY XI ================= */
let draft = null; // local, unsaved editing state for My XI: {_squadId, squad14, xi11, captain, viceCaptain, playingRoles}

/* Squad page's Points tab data — kept separate from draft/render state on
   purpose: renderMyXI() re-renders on every single draft edit (a role
   toggle, a Sub swap, ...), but this only actually changes once a Test
   locks, so it's fetched lazily and cached rather than re-fetched on every
   one of those re-renders. Keyed on squadId + how many Tests are locked
   (not just squadId) so a newly-locked Test on the *same* squad still
   triggers a re-fetch next render. Same shape buildSquadBreakdownRow
   (js/leagues.js) builds for a league standings row — {userId, name,
   managerName, total, byTest} — just built here for mySquad specifically. */
let myxiScoreBreakdown = null; // or null if nothing locked yet
let myxiScoreBreakdownKey;
async function loadMyxiScoreBreakdown(){
  const squad = mySquad;
  const lockedTests = squad ? Object.keys(squad.lockedXiByTest||{}).map(Number) : [];
  const key = squad ? `${squad.id}:${lockedTests.length}` : 'none';
  if(myxiScoreBreakdownKey === key) return; // already have it (or already know there's nothing to have) for this squad
  myxiScoreBreakdownKey = key;
  if(lockedTests.length===0){
    myxiScoreBreakdown = null;
  } else {
    // Only this squad's own locked Tests, not every fixture in the series —
    // no need to fetch match data for a Test it never played through.
    const matchDataByTest = {};
    for(const t of lockedTests){
      matchDataByTest[t] = await getMatchDataForTest(currentSeriesId, t);
    }
    if(myxiScoreBreakdownKey !== key) return; // squad/series moved on again while this was in flight
    myxiScoreBreakdown = buildSquadBreakdownRow(squad, matchDataByTest);
  }
  renderMyXI();
}

// Which of the Squad page's own two sub-tabs is showing — persists across
// re-renders the same way adminScreen (admin-series.js) does. Reset to
// 'select' on switchToSeries() (js/data.js) so switching squads always lands
// back on the editor rather than leaving you on a Points tab that's about to
// repaint with a different squad's data.
let myxiSubtab = 'select'; // 'select' | 'points'

/* Points tab content — the detailed, tabbed-by-Test breakdown for mySquad,
   built from myxiScoreBreakdown above (squadBreakdownPanelsHtml, js/leagues.js
   — same table markup a league standings row's lightbox uses, just embedded
   on the page here instead of behind a tap). Headlines with the most
   recently locked Test's own score, same figure the breakdown panels
   already default their tab to, before the full history underneath it.
   Returns {html, wire(container)} like squadBreakdownPanelsHtml itself,
   since renderMyXI() is the one deciding whether/where this HTML actually
   lands in the DOM this render. */
function renderMyXiPointsTab(){
  if(!myxiScoreBreakdown){
    return {
      html: `<div class="card"><div class="empty-state" style="padding:26px 20px;">No Tests locked yet — once your squad's been through its first lock, detailed scores for each Test show up here.</div></div>`,
      wire: ()=>{},
    };
  }
  const mostRecentTest = Math.max(...Object.keys(myxiScoreBreakdown.byTest).map(Number));
  const {html, wire} = squadBreakdownPanelsHtml(myxiScoreBreakdown.byTest, getPlayer, id=> getPlayer(id).name);
  return {
    html: `
      <div class="scoreboard" style="margin-bottom:16px;">
        <div class="sb-row">
          <div class="sb-team">Test ${mostRecentTest} score</div>
          <div class="sb-score">${myxiScoreBreakdown.byTest[mostRecentTest].pts}</div>
        </div>
      </div>
      <div class="card">${html}</div>
    `,
    wire,
  };
}

/* Local-only autosave for the in-progress draft — so a refresh, an accidental
   tab close, or a flaky connection while editing doesn't throw away work
   that was never committed. Scoped per user + series + squad (squadId is
   null while still building, i.e. before that first "Create squad") so
   switching users/series/squads in the same browser can never cross-pollute
   each other's drafts. This is purely a local cache of unsaved edits — it
   has no bearing on transfer counts or scoring, which only ever look at
   what's actually been committed to Supabase. */
function draftCacheKey(seriesId, squadId){
  return `myxiDraft:${session && session.user ? session.user.id : 'anon'}:${seriesId}:${squadId || 'new'}`;
}
function loadCachedDraft(seriesId, squadId){
  try{
    const raw = localStorage.getItem(draftCacheKey(seriesId, squadId));
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.squad14) || !Array.isArray(parsed.xi11)) return null;
    return parsed;
  }catch(e){ return null; }
}
function saveCachedDraft(seriesId, squadId, draftState){
  try{
    localStorage.setItem(draftCacheKey(seriesId, squadId), JSON.stringify({
      squad14: draftState.squad14,
      xi11: draftState.xi11,
      captain: draftState.captain,
      viceCaptain: draftState.viceCaptain,
      playingRoles: draftState.playingRoles,
    }));
  }catch(e){ /* storage full/unavailable (e.g. private browsing) — editing still works, just isn't cached */ }
}
function clearCachedDraft(seriesId, squadId){
  try{ localStorage.removeItem(draftCacheKey(seriesId, squadId)); }catch(e){}
}

function ensureDraft(){
  const key = mySquad ? mySquad.id : 'new';
  if(!draft || draft._squadId !== key){
    const cached = loadCachedDraft(currentSeriesId, mySquad ? mySquad.id : null);
    draft = cached ? {
      _squadId: key,
      squad14: [...cached.squad14],
      xi11: [...cached.xi11],
      captain: cached.captain || null,
      viceCaptain: cached.viceCaptain || null,
      playingRoles: {...(cached.playingRoles||{})},
    } : {
      _squadId: key,
      squad14: mySquad ? [...mySquad.squad14] : [],
      xi11: mySquad ? [...mySquad.xi11] : [],
      captain: mySquad ? mySquad.captain : null,
      viceCaptain: mySquad ? mySquad.viceCaptain : null,
      playingRoles: mySquad ? {...mySquad.playingRoles} : {},
    };
  }
}
// The playing role actually assigned to pid in the current draft — falls
// back to their base role default (see defaultPlayingRole) until the user
// explicitly picks one from the XI card's role select. This, not the
// player's inherent base role, is what "does the XI have a wicketkeeper"
// should check: the fantasy scoring bonus follows whoever's assigned WK, so
// that's who actually needs to be there.
function assignedPlayingRole(pid){
  return draft.playingRoles[pid] || defaultPlayingRole(getPlayer(pid).role);
}

/* Whether the in-progress My XI draft differs from whatever's actually
   committed (or, while still building a brand-new squad, whether anything's
   been added at all yet). Pulled out standalone — rather than left as a
   local inside renderMyXI() — so switchTab() (js/init.js) can also check it,
   to warn before navigating away from My XI while it's still true. Requires
   ensureDraft() to have run at least once (i.e. My XI has been opened this
   session); returns false otherwise since there's nothing to have changed. */
function hasUncommittedMyXiChanges(){
  if(!draft) return false;
  const squad = mySquad;
  if(!squad) return draft.squad14.length>0;
  return (
    JSON.stringify([...draft.squad14].sort()) !== JSON.stringify([...squad.squad14].sort()) ||
    JSON.stringify([...draft.xi11].sort()) !== JSON.stringify([...squad.xi11].sort()) ||
    draft.captain !== squad.captain || draft.viceCaptain !== squad.viceCaptain
  );
}

// Playing role, captain/VC, Sub and Transfer all used to be separate
// controls crammed onto the card itself (a select, then icon toggles, then a
// labeled button, then a drag gesture, across several rounds of "make it
// cleaner"/"the drag doesn't really work"). They now all live in one place
// instead — the player detail overlay (openPlayerDetailOverlay,
// js/overlays.js), opened by a plain tap on the card. The card itself just
// shows read-only status icons reflecting whatever was chosen there: the
// captain star, a VC tag, and a small icon for the assigned playing role —
// no interactive controls of its own left.
function squadCardHtml(id, zone, baselineSquad14){
  const p = getPlayer(id);
  const isCap = id===draft.captain, isVc = id===draft.viceCaptain;
  const isNew = !baselineSquad14.includes(id);
  const assignedRole = assignedPlayingRole(id);
  // Raw season points this player has scored so far — same total the player
  // picker and rankings already show (seriesPlayerTotals, js/data.js), not a
  // manager-specific captain/role-doubled figure, so it stays meaningful for
  // bench players too (who aren't being multiplied by anything yet) and
  // matches what you'd have compared when you picked them in the first place.
  const points = (seriesPlayerTotals[id] || {total:0}).total;
  // Bench order is the auto-sub priority queue (resolveEffectiveXi,
  // js/scoring.js) — right on the card, to the left of the nat-pill, rather
  // than behind the detail overlay: reordering the bench is common enough
  // (every squad change potentially wants it re-checked) that a whole extra
  // tap just to get to the Up/Down buttons wasn't worth it. See
  // moveBenchPlayer for why this needs the bench-only subset's index, not
  // squad14's raw one — XI members are freely interspersed in squad14.
  let benchOrderBtns = '';
  if(zone==='bench'){
    const benchIds = draft.squad14.filter(bid=>!draft.xi11.includes(bid));
    const benchIdx = benchIds.indexOf(id);
    benchOrderBtns = `
      <button type="button" class="bench-order-btn" data-action="benchUp" data-pid="${id}" ${benchIdx<=0?'disabled':''} title="Move up the sub-priority order" aria-label="Move up the sub-priority order">&#9650;</button>
      <button type="button" class="bench-order-btn" data-action="benchDown" data-pid="${id}" ${benchIdx===-1||benchIdx>=benchIds.length-1?'disabled':''} title="Move down the sub-priority order" aria-label="Move down the sub-priority order">&#9660;</button>
    `;
  }
  return `
    <div class="squad-card" data-pid="${id}" data-zone="${zone}">
      <div class="squad-card-info">
        <div class="squad-card-name">
          ${isCap?'<span class="honours-star">&#9733;</span>':''}${p.name}${isVc?' <span style="font-family:var(--font-mono); font-size:9.5px;">VC</span>':''}${isNew?' <span style="color:var(--gilt-bright); font-family:var(--font-mono); font-size:9px;">NEW</span>':''}
          <span class="role-icon-badge" title="Playing role: ${ROLE_LABEL[assignedRole]}">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ROLE_ICON_PATH[assignedRole]}</svg>
          </span>
        </div>
        <div class="squad-card-tags">
          ${benchOrderBtns}
          <span class="nat-pill">${p.nat}</span>
        </div>
      </div>
      <div class="squad-card-points" title="Points scored this series">${points}</div>
    </div>`;
}
function emptySlotHtml(zone){
  return `<button type="button" class="squad-card empty" data-empty-zone="${zone}" data-action="add" data-zone="${zone}">+ Add player</button>`;
}

/* Whether the Transfer button should be blocked outright, rather than
   letting a 3rd/4th/... swap through and only warning about it after the
   fact (the transfer-count status chip's own warn-icon in renderMyXI() is
   that after-the-fact indicator, for anyone who still gets there some other
   way — e.g. undoing and reapplying the same swap without going back
   through Transfer). Blocked once the draft's already at (not just past)
   the free 2-transfer limit since the last lock, unless the wildcard's
   armed to lift it — before a squad's first lock there's no limit at all,
   same as everywhere else transfers are counted. */
function transfersAtLimit(){
  if(!mySquad || !draft) return false;
  const hasLockedOnce = !!(mySquad.lockedXiByTest && Object.keys(mySquad.lockedXiByTest).length > 0);
  if(!hasLockedOnce || mySquad.wildcardActiveNow) return false;
  const baselineSquad14 = (mySquad.baselineSquad14 && mySquad.baselineSquad14.length) ? mySquad.baselineSquad14 : draft.squad14;
  return countChanges(draft.squad14, baselineSquad14) >= 2;
}

/* "Transfer" — opens the full player picker (anyone in the series not
   already in your 14) and, on pick, swaps outId out of the squad entirely
   for whoever's chosen. The only caller is the player detail overlay's
   Transfer button (openPlayerDetailOverlay, js/overlays.js). */
function transferSquadPlayer(outId){
  openPlayerPicker(draft.squad14, (newId)=>{
    const newSquad14 = draft.squad14.filter(id=>id!==outId).concat([newId]);
    // Belt-and-braces: the picker already greys out infeasible candidates
    // (via the countBasisIds arg below), this just catches it if that ever
    // falls out of sync.
    const check = validateSquad14(newSquad14);
    if(!check.valid){
      showAlert(`That would leave your squad invalid: ${check.errors.join(' ')}`, "Can't make that change");
      return;
    }
    draft.squad14 = newSquad14;
    // Straight 1-for-1 swap — the incoming player always takes the outgoing
    // one's exact spot (XI or bench), full stop — see the git history for
    // why this isn't gated on keeping a wicketkeeper in the XI.
    if(draft.xi11.includes(outId)) draft.xi11 = draft.xi11.filter(id=>id!==outId).concat([newId]);
    if(draft.captain===outId) draft.captain = null;
    if(draft.viceCaptain===outId) draft.viceCaptain = null;
    delete draft.playingRoles[outId];
    renderMyXI();
  }, draft.squad14.filter(id=>id!==outId));
}

/* "Sub" — opens a lightbox listing whoever's currently in the OTHER zone
   (bench, if pid is in the XI; XI, if pid is on the bench) and swaps pid
   with whichever one gets picked. Same "one out, one in, same two zones" swap
   the drag gesture used to do — this is what replaced it (see squadCardHtml's
   comment) once it turned out not to be reliable enough on touch. Doesn't
   touch squad14 itself (just which 11 of the same 14 are the starting XI),
   so — unlike Transfer — there's no 5-per-team/14-man check to redo here.
   The only caller is the player detail overlay's Sub button
   (openPlayerDetailOverlay, js/overlays.js). */
function subSquadPlayer(pid, zone){
  const otherZoneIds = zone==='xi' ? draft.squad14.filter(id=>!draft.xi11.includes(id)) : draft.xi11;
  if(otherZoneIds.length===0){
    showAlert(zone==='xi' ? "There's no one on the bench to sub in." : 'Your starting XI is empty — add players to it first.');
    return;
  }
  openSquadZonePicker(otherZoneIds, zone==='xi' ? 'Sub in from the bench' : 'Sub in from the XI', swapId=>{
    if(zone==='xi'){
      draft.xi11 = draft.xi11.filter(id=>id!==pid).concat([swapId]);
    } else {
      draft.xi11 = draft.xi11.filter(id=>id!==swapId).concat([pid]);
    }
    renderMyXI();
  });
}

/* Moves pid up (direction -1) or down (direction 1) among the OTHER bench
   players — bench order is the auto-sub priority queue (resolveEffectiveXi,
   js/scoring.js: the first bench player in this order who actually played
   fills in for an XI player who didn't), and this is its only editing path
   now that reordering-by-drag is gone. Bench order is read off squad14's own
   relative order (see draftBench in renderMyXI()), with XI members freely
   interspersed in that same array — so "swap with the neighbouring bench
   player" means finding that neighbour among bench-only entries first, then
   swapping their two absolute squad14 positions, not just adjacent squad14
   indices. A pure mutator (like assignedPlayingRole is a pure getter) — the
   bench card's own Up/Down buttons (squadCardHtml, wired in renderMyXI())
   call renderMyXI() themselves straight after. */
function moveBenchPlayer(pid, direction){
  const benchIds = draft.squad14.filter(id=>!draft.xi11.includes(id));
  const idx = benchIds.indexOf(pid);
  const swapIdx = idx + direction;
  if(idx===-1 || swapIdx<0 || swapIdx>=benchIds.length) return;
  const otherId = benchIds[swapIdx];
  const aIdx = draft.squad14.indexOf(pid), bIdx = draft.squad14.indexOf(otherId);
  if(aIdx===-1 || bIdx===-1) return;
  [draft.squad14[aIdx], draft.squad14[bIdx]] = [draft.squad14[bIdx], draft.squad14[aIdx]];
}

function renderMyXI(){
  const c = document.getElementById('myxiContent');
  if(!session){ c.innerHTML = `<div class="empty-state"><div class="big">Log in to see your XI</div></div>`; return; }

  if(!currentSeriesId){
    if(seriesList.length===0){
      c.innerHTML = `<div class="empty-state"><div class="big">No series available yet</div>Ask an admin to set one up under Admin Hub.</div>`;
      return;
    }
    c.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0; font-family:var(--font-display);">Pick a series</h3>
        <p class="panel-sub" style="margin-top:0;">Choose which series to build your team for — that's all it takes to start. Joining a league to compare against friends is a separate, optional step under My Leagues.</p>
        ${seriesList.map(s=>`
          <div class="player-row" data-sid="${s.id}">
            <div class="player-name-wrap"><span class="player-name">${s.name}</span></div>
            <div class="player-row-actions"><button class="btn small" data-action="pickSeries" data-sid="${s.id}">Start team</button></div>
          </div>`).join('')}
      </div>
    `;
    c.querySelectorAll('[data-action="pickSeries"]').forEach(btn=>{
      btn.addEventListener('click', ()=> switchToSeries(btn.dataset.sid));
    });
    return;
  }

  const activeSeries = seriesList.find(s=>s.id===currentSeriesId) || {id: currentSeriesId, name: 'this series'};
  loadMyxiScoreBreakdown(); // fire-and-forget — see its own comment; re-renders itself once (if) it resolves with something new
  ensureDraft();
  // Every draft mutation below re-renders via renderMyXI(), so caching right
  // here after ensureDraft() catches every one of them in a single place
  // rather than needing a save call sprinkled after each handler.
  saveCachedDraft(currentSeriesId, mySquad ? mySquad.id : null, draft);
  const squad = mySquad;
  const isBuilding = !squad;
  const hasLockedOnce = !!(squad && squad.lockedXiByTest && Object.keys(squad.lockedXiByTest).length > 0);
  const baselineSquad14 = (squad && squad.baselineSquad14 && squad.baselineSquad14.length) ? squad.baselineSquad14 : draft.squad14;
  const transfers = (isBuilding || !hasLockedOnce) ? 0 : countChanges(draft.squad14, baselineSquad14);
  const overLimit = hasLockedOnce && transfers > 2;
  const squad14Check = validateSquad14(draft.squad14);
  const xiHasWK = draft.xi11.some(id=>assignedPlayingRole(id)==='WK');
  const xiFull = draft.xi11.length===11;
  // Commit just declares your intended squad for the upcoming Test — it's never
  // blocked by the transfer count. The 2-transfer limit (and the wildcard) only
  // actually gets evaluated when the Test locks at the deadline, and only starts
  // applying once your squad has been through its first lock — before that (i.e.
  // right up to the very first Test's deadline) there's no limit at all.
  const canCommit = squad14Check.valid && xiFull && xiHasWK;
  // Whatever's currently blocking commit, as plain sentences — surfaced via
  // a single warn-icon next to the Commit button (see commitIssuesBtn below)
  // rather than as permanent text on screen.
  const blockingIssues = [
    ...(draft.squad14.length>0 ? squad14Check.errors : []),
    ...(xiFull && !xiHasWK ? ['Your starting XI needs someone assigned as wicketkeeper — set it from the role dropdown on one of your XI cards.'] : []),
  ];
  const draftBench = draft.squad14.filter(id=>!draft.xi11.includes(id));
  const draftDiffersFromCommitted = hasUncommittedMyXiChanges();
  // Which series/squad options the header pill's overlay should offer (see
  // openSeriesSwitchOverlay) — every series that isn't the one showing now
  // and doesn't already have a squad on it.
  const newSeriesOptions = seriesList.filter(s=> s.id!==currentSeriesId && !mySquads.some(sq=>sq.seriesId===s.id));

  const xiSlotsHtml = Array.from({length:11}, (_,i)=> draft.xi11[i] ? squadCardHtml(draft.xi11[i], 'xi', baselineSquad14) : emptySlotHtml('xi')).join('');
  const benchSlotsHtml = Array.from({length:3}, (_,i)=> draftBench[i] ? squadCardHtml(draftBench[i], 'bench', baselineSquad14) : emptySlotHtml('bench')).join('');

  // "Select Team" tab — the squad-building UI, unchanged from before this
  // page had tabs at all. Also what shows on its own, with no tab strip,
  // while still building a brand-new squad (isBuilding) — there's no Points
  // to show yet, and no committed squad underneath it to switch back to.
  const selectTeamTabHtml = `
    <div class="team-name-row" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
      ${!isBuilding ? `
        <span style="font-family:var(--font-display); font-size:17px;">${squad.teamName}</span>
        <button type="button" class="row-icon-btn primary" id="renameTeamBtn" title="Rename team" aria-label="Rename team">&#9998;</button>
        ${squad.wildcardActiveNow ? `<button type="button" class="btn danger small" id="resetSquadBtn">Reset Team</button>` : ''}
      ` : `<span style="font-family:var(--font-display); font-size:17px; color:var(--parchment-dim);">New team</span>`}
    </div>
    ${!isBuilding && hasLockedOnce ? `
      <div class="wildcard-row">
        ${squad.wildcardUsed
          ? `<button class="btn secondary" disabled>Wildcard used</button>`
          : squad.wildcardActiveNow
            ? `<button class="btn danger" id="wildcardCancelBtn">Cancel wildcard</button>`
            : `<button class="btn danger" id="wildcardBtn">Activate wildcard</button>`}
      </div>
    ` : ''}
    ${isBuilding ? `
      <div class="card" style="margin-bottom:16px;">
        <label class="field-label">Team name</label>
        <input type="text" id="teamNameField" placeholder="e.g. Bodyline Bandits" maxlength="30" value="${window.__pendingTeamName||''}" style="width:100%; max-width:360px; padding:9px; border:1px solid var(--parchment-dim); border-radius:5px;">
      </div>
    ` : ''}

    ${!isBuilding && hasLockedOnce ? `
      <div class="swap-status-row">
        <div class="status-chip">
          <div class="label">Transfers vs last locked squad</div>
          <div class="value">${transfers} / 2${overLimit && !squad.wildcardActiveNow ? ` <button type="button" class="warn-icon" id="transferWarnBtn" title="Over the free limit" aria-label="Warning">!</button>` : ''}</div>
        </div>
      </div>
    ` : ''}

    <div class="squad-editor">
      <div class="squad-zone" id="xiZone" data-zone="xi">
        <div class="zone-title">Starting XI (${draft.xi11.length}/11)</div>
        <div class="zone-slots" data-zone-slots="xi">${xiSlotsHtml}</div>
      </div>
      <div class="squad-zone" id="benchZone" data-zone="bench">
        <div class="zone-title">Bench (${draftBench.length}/3)</div>
        <div class="zone-slots" data-zone-slots="bench">${benchSlotsHtml}</div>
      </div>
    </div>
  `;

  // "Points" tab — nothing to show it for yet while still building.
  const pointsTab = isBuilding ? {html: '', wire: ()=>{}} : renderMyXiPointsTab();

  c.innerHTML = `
    <div class="flex-between" style="margin-bottom:14px;">
      <h2 class="panel-title" style="margin-bottom:0;">My Squads <button type="button" class="help-icon" id="myXiHelpBtn" title="What's this?" aria-label="Help">?</button></h2>
      ${switcherPillHtml('seriesPillBtn', activeSeries.name, 'Switch series or squad')}
    </div>
    ${draftDiffersFromCommitted ? `
      <div class="notice warn" style="margin-bottom:18px;">
        <strong>Unsaved changes</strong> — they won't count for scoring until you confirm.
        ${blockingIssues.length ? `<button type="button" class="warn-icon" id="commitIssuesBtn" title="Why can't I confirm?" aria-label="Warning">!</button>` : ''}
        <div style="display:flex; gap:10px; margin-top:12px;">
          <button type="button" class="btn secondary" id="revertBtn" style="flex:1;" title="${isBuilding ? 'Clear all' : 'Revert to last committed squad'}">Undo</button>
          <button type="button" class="btn" id="commitBtn" ${canCommit?'':'disabled'} style="flex:1;" title="${isBuilding ? 'Create squad' : 'Confirm changes'}">Confirm</button>
        </div>
      </div>
    ` : ''}
    ${!isBuilding ? `
      <div class="admin-subnav" id="myxiSubtabs" style="margin:4px 0 20px;">
        <button type="button" class="subtab-btn${myxiSubtab==='points'?' active':''}" data-myxi-subtab="points">Points</button>
        <button type="button" class="subtab-btn${myxiSubtab==='select'?' active':''}" data-myxi-subtab="select">Select Team</button>
      </div>
    ` : ''}
    ${isBuilding || myxiSubtab==='select' ? selectTeamTabHtml : pointsTab.html}
  `;

  document.getElementById('myXiHelpBtn').addEventListener('click', ()=> showAlert("Build your 14-man squad, arrange your starting XI (11 of the 14 — the rest sit on the bench), assign each XI player a playing role, and set a captain and vice-captain, then commit to declare your squad for the next Test. Moving between XI and bench (or reordering the bench) is always free. There's no transfer limit until your first Test locks — after that, swapping anyone in or out of your 14 counts as a transfer, capped at 2 per Test unless you arm your wildcard. Team names must be unique within the series.", 'My Squads'));
  document.getElementById('seriesPillBtn').addEventListener('click', ()=> openSeriesSwitchOverlay(newSeriesOptions));
  c.querySelectorAll('[data-myxi-subtab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ myxiSubtab = btn.dataset.myxiSubtab; renderMyXI(); });
  });
  if(!isBuilding && myxiSubtab==='points') pointsTab.wire(c);

  const transferWarnBtn = document.getElementById('transferWarnBtn');
  if(transferWarnBtn) transferWarnBtn.addEventListener('click', e=>{
    e.stopPropagation();
    showAlert(`This draft differs from your last locked squad by <strong>${transfers} players</strong> — more than the free 2. You can still commit and preview it, but you'll want to arm your wildcard or trim it back to 2 before the deadline: the league rule is enforced by whoever locks the Test, not automatically by this warning.`, 'Over the transfer limit');
  });
  const commitIssuesBtn = document.getElementById('commitIssuesBtn');
  if(commitIssuesBtn) commitIssuesBtn.addEventListener('click', ()=> showAlert(blockingIssues.join(' '), "Can't commit yet"));

  /* ---- persist team name field across re-renders (every card action re-renders this panel) ---- */
  const teamNameFieldEl = document.getElementById('teamNameField');
  if(teamNameFieldEl){
    teamNameFieldEl.addEventListener('input', ()=>{ window.__pendingTeamName = teamNameFieldEl.value; });
  }

  /* ---- card actions ----
     Captain/VC, playing role and replace all moved into the player detail
     overlay (openPlayerDetailOverlay, js/overlays.js) — see squadCardHtml's
     comment above for why. "add" (an empty XI/bench slot's own button, not
     part of a card) is the only one still wired here. */
  c.querySelectorAll('[data-action="add"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const zone = btn.dataset.zone;
      if(draft.squad14.length>=14){ showAlert('Your squad already has 14 players.'); return; }
      if(zone==='xi' && draft.xi11.length>=11){ showAlert('Your starting XI already has 11 players.'); return; }
      openPlayerPicker(draft.squad14, (newId)=>{
        draft.squad14.push(newId);
        if(zone==='xi') draft.xi11.push(newId);
        renderMyXI();
      });
    });
  });

  /* ---- tap a card to open its detail overlay ----
     Used to also handle a long-press-to-drag gesture for reordering/swapping
     zones directly on the card — dropped in favour of the player detail
     overlay's explicit Sub/Transfer buttons (openPlayerDetailOverlay,
     js/overlays.js) instead, since the drag never worked reliably enough
     across devices. Every other card action already lived in that overlay
     anyway (see squadCardHtml's comment above), so this is now a plain tap —
     except the bench Up/Down buttons below, which stay right on the card. */
  c.querySelectorAll('.squad-card[data-pid]').forEach(card=>{
    card.addEventListener('click', ()=> openPlayerDetailOverlay(card.dataset.pid, card.dataset.zone));
  });

  /* ---- bench order (Up/Down, on the card itself — see squadCardHtml) ----
     Reordering the sub-priority queue is common enough to want without a
     detour through the detail overlay first, unlike everything else that
     lives there. stopPropagation so a tap on either button doesn't also
     bubble up to the card's own click listener above and pop the overlay
     open behind it. */
  c.querySelectorAll('[data-action="benchUp"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      moveBenchPlayer(btn.dataset.pid, -1);
      renderMyXI();
    });
  });
  c.querySelectorAll('[data-action="benchDown"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      moveBenchPlayer(btn.dataset.pid, 1);
      renderMyXI();
    });
  });

  /* ---- rename team ---- */
  const renameTeamBtn = document.getElementById('renameTeamBtn');
  if(renameTeamBtn) renameTeamBtn.addEventListener('click', ()=> openRenameTeamOverlay(squad));

  /* ---- wildcard ---- */
  const wcBtn = document.getElementById('wildcardBtn');
  if(wcBtn) wcBtn.addEventListener('click', async ()=>{
    if(!(await showConfirm("This lifts the 2-transfer limit for your commits. It's only actually used up if you commit while it's armed and your squad locks in that way — you can cancel it beforehand at no cost.", 'Activate your one-time wildcard?'))) return;
    squad.wildcardActiveNow = true;
    await saveMySquad();
    renderMyXI();
  });
  const wcCancelBtn = document.getElementById('wildcardCancelBtn');
  if(wcCancelBtn) wcCancelBtn.addEventListener('click', async ()=>{
    squad.wildcardActiveNow = false;
    squad.wildcardCommittedPending = false;
    await saveMySquad();
    renderMyXI();
  });

  /* ---- revert / clear / reset ---- */
  // revertBtn (and commitBtn below) only render once there's actually a
  // change to commit or undo — see draftDiffersFromCommitted above.
  const revertBtn = document.getElementById('revertBtn');
  if(revertBtn) revertBtn.addEventListener('click', async ()=>{
    if(isBuilding){
      draft.squad14 = []; draft.xi11 = []; draft.captain = null; draft.viceCaptain = null; draft.playingRoles = {};
      renderMyXI();
      return;
    }
    if(!(await showConfirm('Discard your draft edits and go back to your last committed squad?', 'Revert changes?'))) return;
    draft.squad14 = [...squad.squad14];
    draft.xi11 = [...squad.xi11];
    draft.captain = squad.captain;
    draft.viceCaptain = squad.viceCaptain;
    draft.playingRoles = {...squad.playingRoles};
    renderMyXI();
  });
  const resetBtn = document.getElementById('resetSquadBtn');
  if(resetBtn) resetBtn.addEventListener('click', async ()=>{
    const sharedLeagueCount = myLeagues.filter(l=>l.seriesId===currentSeriesId).length;
    const warning = sharedLeagueCount > 0
      ? ` You're in ${sharedLeagueCount} league${sharedLeagueCount>1?'s':''} on this series — they'll show no team for you until you pick a new one.`
      : '';
    if(!(await showConfirm(`Reset your team on this series? This cannot be undone.${warning}`, 'Reset team'))) return;
    const {error} = await supabaseClient.from('squads').delete().eq('user_id', session.user.id).eq('series_id', currentSeriesId);
    if(error){ showAlert(error.message); return; }
    clearCachedDraft(currentSeriesId, squad ? squad.id : null);
    draft = null;
    window.__pendingTeamName = '';
    localStorage.removeItem('currentSeriesId');
    currentSeriesId = null; // let loadMySquads() re-resolve from scratch, since localStorage no longer points at the just-deleted series
    await loadMySquads();
    if(currentSeriesId){ await Promise.all([loadPlayers(currentSeriesId), loadFixtures(currentSeriesId), loadSeriesPlayerTotals(currentSeriesId)]); }
    else { PLAYERS = []; PLAYER_MAP = {}; fixtures = []; seriesPlayerTotals = {}; }
    renderAll();
    renderCountdown();
  });

  /* ---- commit ---- */
  const commitBtn = document.getElementById('commitBtn');
  if(commitBtn) commitBtn.addEventListener('click', async ()=>{
    const check = validateSquad14(draft.squad14);
    if(!check.valid){ showAlert(check.errors.join(' '), 'Squad is invalid'); return; }
    if(draft.xi11.length!==11){ showAlert('Your starting XI must have exactly 11 players.'); return; }
    if(!draft.xi11.some(id=>assignedPlayingRole(id)==='WK')){
      showAlert('Your XI must include someone assigned as wicketkeeper.'); return;
    }
    if(!draft.captain || !draft.viceCaptain){
      showAlert('Choose both a Captain and a Vice-Captain before committing.'); return;
    }
    if(draft.captain === draft.viceCaptain){
      showAlert('Captain and Vice-Captain must be different players.'); return;
    }

    // Fill in a default playing role for anyone who never touched the
    // selector (or joined via Sub/Transfer/add rather than explicitly
    // choosing one), so what actually gets committed/locked always has an
    // explicit role for every squad member rather than relying on the
    // fallback at score time.
    draft.squad14.forEach(pid=>{
      if(!draft.playingRoles[pid]) draft.playingRoles[pid] = defaultPlayingRole(getPlayer(pid).role);
    });

    if(isBuilding){
      const nameField = document.getElementById('teamNameField');
      const teamName = nameField ? nameField.value.trim() : '';
      if(!teamName){ showAlert('Enter a team name first.'); return; }

      const {data:userData, error:userErr} = await supabaseClient.auth.getUser();
      if(userErr || !userData || !userData.user){
        showAlert('Your session looks out of date. Please log out and log back in, then try again.', 'Session problem');
        return;
      }
      const bench = draft.squad14.filter(id=>!draft.xi11.includes(id));
      const managerName = [myFirstName, myLastName].filter(Boolean).join(' ');
      const {error} = await supabaseClient.from('squads').insert({
        user_id: userData.user.id,
        series_id: currentSeriesId,
        team_name: teamName,
        manager_name: managerName || null,
        squad14: draft.squad14, xi11: draft.xi11, bench3: bench,
        captain: draft.captain, vice_captain: draft.viceCaptain,
        baseline_squad14: draft.squad14,
        wildcard_committed_pending: false,
        playing_roles: draft.playingRoles,
      });
      if(error){
        if(error.code === '23503'){
          showAlert('Your account session is out of sync with the database. Please log out, log back in, and try again.', 'Could not create squad');
        } else if(error.code === '23505'){
          showAlert('That team name is already taken on this series — pick a different one.', 'Could not create squad');
        } else {
          showAlert('Could not create squad: '+error.message, 'Error');
        }
        return;
      }
      clearCachedDraft(currentSeriesId, null); // the "still building" cache entry — mySquad now exists, so ensureDraft() moves on to a squadId-keyed one
      draft = null;
      window.__pendingTeamName = '';
      localStorage.setItem('currentSeriesId', currentSeriesId);
      await loadMySquads();
      renderAuthRow();
      renderAll();
      showAlert(`Team created for ${activeSeries.name} — this is what will be scored once the first Test locks. Join a league under My Leagues if you'd like to compare against friends.`, 'Team created');
      return;
    }

    squad.squad14 = [...draft.squad14];
    squad.xi11 = [...draft.xi11];
    squad.bench3 = draft.squad14.filter(id=>!draft.xi11.includes(id));
    squad.captain = draft.captain;
    squad.viceCaptain = draft.viceCaptain;
    squad.playingRoles = {...draft.playingRoles};
    if(squad.wildcardActiveNow) squad.wildcardCommittedPending = true;
    await saveMySquad();
    const transferCount = countChanges(draft.squad14, baselineSquad14);
    const commitMsg = (hasLockedOnce && transferCount > 2 && !squad.wildcardActiveNow)
      ? `Committed — but this is ${transferCount} transfers from your last locked squad, over the free limit of 2. It's still what will be scored if the Test locks right now, so trim it back or arm your wildcard before the deadline if that's not what you intend.`
      : "Committed — this is what will be scored if the next Test locks right now. You can keep adjusting and re-committing until the deadline.";
    showAlert(commitMsg, 'Squad committed');
    renderMyXI();
  });
}

/* Renames an already-created squad — team_name is only ever collected up
   front during squad creation (see #teamNameField in the commit handler
   above), so this is the only path back to it afterward. Mirrors
   openRenameSeriesOverlay in admin-series.js. team_name is unique per series
   (squads_series_id_team_name_key), so a clash surfaces as a 23505 same as
   squad creation does. */
function openRenameTeamOverlay(squad){
  const backdrop = openOverlay(`
    <div class="overlay-title">Rename team</div>
    <div class="field-group"><label for="renameTeamInput">Team name</label><input type="text" id="renameTeamInput" value="${squad.teamName}" maxlength="30"></div>
    <div class="auth-error" id="renameTeamError"></div>
    <div class="overlay-actions"><button class="btn" data-overlay-ok>Save</button></div>
  `);
  const errBox = backdrop.querySelector('#renameTeamError');
  backdrop.querySelector('[data-overlay-close]').addEventListener('click', closeOverlay);
  backdrop.addEventListener('click', e=>{ if(e.target===backdrop) closeOverlay(); });
  backdrop.querySelector('[data-overlay-ok]').addEventListener('click', async ()=>{
    const newName = document.getElementById('renameTeamInput').value.trim();
    if(!newName){ errBox.textContent = 'Enter a team name.'; return; }
    if(newName === squad.teamName){ closeOverlay(); return; }
    const {error} = await supabaseClient.from('squads').update({team_name: newName}).eq('id', squad.id);
    if(error){
      errBox.textContent = error.code === '23505' ? 'That team name is already taken on this series — pick a different one.' : error.message;
      return;
    }
    closeOverlay();
    await loadMySquads();
    renderAll();
  });
}

/* Reached from openSeriesSwitchOverlay's (js/overlays.js) "Start a team in
   another series" — picks which series to start a new team on, same "skip
   the prompt if there's only one option" shortcut openAddInningsOverlay
   (admin-match.js) uses. */
function openStartNewTeamOverlay(options){
  if(options.length===1){ switchToSeries(options[0].id); return; }
  const backdrop = openOverlay(`
    <div class="overlay-title">Start a new team</div>
    <div class="overlay-message">Which series?</div>
    <div class="overlay-actions" style="justify-content:center; gap:10px; flex-direction:column; align-items:stretch;">
      ${options.map(s=>`<button class="btn secondary" data-pick-series="${s.id}">${s.name}</button>`).join('')}
    </div>
  `);
  backdrop.querySelectorAll('[data-pick-series]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ closeOverlay(); switchToSeries(btn.dataset.pickSeries); });
  });
}

