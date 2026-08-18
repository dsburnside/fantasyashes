/* js/myxi.js — the My XI tab: squad building, XI/bench drag-drop, captain/VC/playing-role assignment, commit flow. */
/* ================= MY XI ================= */
let draft = null; // local, unsaved editing state for My XI: {_squadId, squad14, xi11, captain, viceCaptain, playingRoles}

/* Squad page's own "most recent Test" scoreboard card — kept separate from
   draft/render state on purpose: renderMyXI() re-renders on every single
   draft edit (a role toggle, a drag reorder, ...), but this only actually
   changes once a Test locks, so it's fetched lazily and cached rather than
   re-fetched on every one of those re-renders. Keyed on squadId + how many
   Tests are locked (not just squadId) so a newly-locked Test on the *same*
   squad still triggers a re-fetch next render. */
let myxiRecentScore = null; // {test, pts} for mySquad's most recently locked Test, or null if none locked yet
let myxiRecentScoreKey;
async function loadMyxiRecentScore(){
  const squad = mySquad;
  const lockedTests = squad ? Object.keys(squad.lockedXiByTest||{}).map(Number) : [];
  const key = squad ? `${squad.id}:${lockedTests.length}` : 'none';
  if(myxiRecentScoreKey === key) return; // already have it (or already know there's nothing to have) for this squad
  myxiRecentScoreKey = key;
  if(lockedTests.length===0){
    myxiRecentScore = null;
  } else {
    const test = Math.max(...lockedTests);
    const {stats, playingXi} = await getMatchDataForTest(currentSeriesId, test);
    if(myxiRecentScoreKey !== key) return; // squad/series moved on again while this was in flight
    myxiRecentScore = {test, pts: Math.round(computeTestScore(squad.lockedXiByTest[test], stats, playingXi)*10)/10};
  }
  renderMyXI();
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

// Playing role, captain/VC and replace all used to be separate buttons
// crammed onto the card itself (a select, then icon toggles, then a labeled
// button, across several rounds of "make it cleaner"). They now all live in
// one place instead — the player detail overlay (openPlayerDetailOverlay,
// js/overlays.js), opened by a plain tap on the card (dragging still
// repositions/swaps zones — see the pointer handler below). The card itself
// just shows read-only status icons reflecting whatever was chosen there:
// the captain star, a VC tag, and a small icon for the assigned playing
// role — no interactive controls of its own left to fight the drag gesture
// for the pointer, which is also why DRAG_EXCLUDE_SELECTOR is gone below.
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
          <span class="nat-pill">${p.nat}</span>
        </div>
      </div>
      <div class="squad-card-points" title="Points scored this series">${points}</div>
    </div>`;
}
function emptySlotHtml(zone){
  return `<button type="button" class="squad-card empty" data-empty-zone="${zone}" data-action="add" data-zone="${zone}">+ Add player</button>`;
}

/* Opens the player picker and, on pick, swaps outId for whoever's chosen.
   Used to be inline in the card's own "Replace" button; now the only caller
   is the player detail overlay (openPlayerDetailOverlay, js/overlays.js),
   since that's where the action lives — see squadCardHtml's comment above. */
function replaceSquadPlayer(outId){
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

function renderMyXI(){
  const c = document.getElementById('myxiContent');
  if(!session){ c.innerHTML = `<div class="empty-state"><div class="big">Log in to see your XI</div></div>`; return; }

  if(!currentSeriesId){
    if(seriesList.length===0){
      c.innerHTML = `<div class="empty-state"><div class="big">No series available yet</div>Ask an admin to set one up under Admin &rarr; Series Setup.</div>`;
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
  loadMyxiRecentScore(); // fire-and-forget — see its own comment; re-renders itself once (if) it resolves with something new
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
  // Tab strip rather than a <select> — same pattern (and same reasoning) as
  // Admin's series tabs and My Leagues' league tabs: switching between a
  // handful of options is more immediately obvious as tabs you tap than as a
  // dropdown you have to open first, and it sits flush under the heading
  // (no card wrapper) rather than in its own indented box.
  const newSeriesOptions = seriesList.filter(s=> s.id!==currentSeriesId && !mySquads.some(sq=>sq.seriesId===s.id));
  const seriesSwitcherHtml = (mySquads.length>0 || newSeriesOptions.length>0) ? `
    <div class="admin-subnav" id="seriesSwitchTabs" style="margin:4px 0 20px;">
      ${mySquads.map(s=>{
        const sname = (seriesList.find(x=>x.id===s.seriesId)||{}).name || 'Unknown series';
        return `<button class="subtab-btn${s.seriesId===currentSeriesId?' active':''}" data-switch-series="${s.seriesId}">${sname}</button>`;
      }).join('')}
      ${isBuilding ? `<button class="subtab-btn active" data-switch-series="${currentSeriesId}">${activeSeries.name} <span class="muted" style="font-size:10px;">(new)</span></button>` : ''}
      ${newSeriesOptions.length ? `<button type="button" class="tab-add-btn" id="seriesSwitchAddBtn" title="Start a team in another series">+</button>` : ''}
    </div>
  ` : '';

  const xiSlotsHtml = Array.from({length:11}, (_,i)=> draft.xi11[i] ? squadCardHtml(draft.xi11[i], 'xi', baselineSquad14) : emptySlotHtml('xi')).join('');
  const benchSlotsHtml = Array.from({length:3}, (_,i)=> draftBench[i] ? squadCardHtml(draftBench[i], 'bench', baselineSquad14) : emptySlotHtml('bench')).join('');

  c.innerHTML = `
    <h2 class="panel-title">My Squads <button type="button" class="help-icon" id="myXiHelpBtn" title="What's this?" aria-label="Help">?</button></h2>
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
    ${seriesSwitcherHtml}
    <div class="team-name-row" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
      ${!isBuilding ? `
        <span style="font-family:var(--font-display); font-size:17px;">${squad.teamName}</span>
        <button type="button" class="row-icon-btn primary" id="renameTeamBtn" title="Rename team" aria-label="Rename team">&#9998;</button>
        ${squad.wildcardActiveNow ? `<button type="button" class="btn danger small" id="resetSquadBtn">Reset Team</button>` : ''}
      ` : `<span style="font-family:var(--font-display); font-size:17px; color:var(--parchment-dim);">New team</span>`}
    </div>
    ${myxiRecentScore ? `
      <div class="scoreboard" style="margin-bottom:14px;">
        <div class="sb-row">
          <div class="sb-team">Test ${myxiRecentScore.test} score</div>
          <div class="sb-score">${myxiRecentScore.pts}</div>
        </div>
      </div>
    ` : ''}
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

  document.getElementById('myXiHelpBtn').addEventListener('click', ()=> showAlert("Build your 14-man squad, arrange your starting XI (11 of the 14 — the rest sit on the bench), assign each XI player a playing role, and set a captain and vice-captain, then commit to declare your squad for the next Test. Moving between XI and bench (or reordering the bench) is always free. There's no transfer limit until your first Test locks — after that, swapping anyone in or out of your 14 counts as a transfer, capped at 2 per Test unless you arm your wildcard. Team names must be unique within the series.", 'My Squads'));

  const transferWarnBtn = document.getElementById('transferWarnBtn');
  if(transferWarnBtn) transferWarnBtn.addEventListener('click', e=>{
    e.stopPropagation();
    showAlert(`This draft differs from your last locked squad by <strong>${transfers} players</strong> — more than the free 2. You can still commit and preview it, but you'll want to arm your wildcard or trim it back to 2 before the deadline: the league rule is enforced by whoever locks the Test, not automatically by this warning.`, 'Over the transfer limit');
  });
  const commitIssuesBtn = document.getElementById('commitIssuesBtn');
  if(commitIssuesBtn) commitIssuesBtn.addEventListener('click', ()=> showAlert(blockingIssues.join(' '), "Can't commit yet"));

  c.querySelectorAll('[data-switch-series]').forEach(btn=>{
    btn.addEventListener('click', ()=> switchToSeries(btn.dataset.switchSeries));
  });
  const seriesSwitchAddBtn = document.getElementById('seriesSwitchAddBtn');
  if(seriesSwitchAddBtn) seriesSwitchAddBtn.addEventListener('click', ()=> openStartNewTeamOverlay(newSeriesOptions));

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

  /* ---- drag and drop between zones (and onto a card to swap or reorder) ---- */
  function moveOrSwap(draggedId, targetZone, targetId){
    if(!draggedId || draggedId===targetId) return;
    const draggedInXi = draft.xi11.includes(draggedId);
    const draggedZone = draggedInXi ? 'xi' : 'bench';

    if(targetId){
      const targetInXi = draft.xi11.includes(targetId);
      const targetZoneActual = targetInXi ? 'xi' : 'bench';
      if(draggedZone === targetZoneActual){
        // dropped onto a card in its own zone — reorder rather than swap zones.
        // Bench order matters (it's the substitute priority queue) and is
        // read off squad14's own relative order (see draftBench above), so
        // reordering there splices squad14. The XI is rendered off xi11's
        // own array order instead (see xiSlotsHtml above) — splicing
        // squad14 for an XI-to-XI reorder was a no-op as far as the visible
        // XI order went, which is why reordering the XI never appeared to
        // do anything; splice xi11 itself instead.
        const list = draggedZone==='xi' ? draft.xi11 : draft.squad14;
        const from = list.indexOf(draggedId);
        const targetIdxBefore = list.indexOf(targetId);
        if(from===-1 || targetIdxBefore===-1) return;
        list.splice(from, 1);
        let to = list.indexOf(targetId); // shifts down by 1 once `from` is removed, if it was after `from`
        // Dragging DOWN the list (from was above target): land just past the
        // target, not right before it — before this fix, removing `from`
        // shifted the target's index down by 1 too, so re-inserting "at" that
        // index always put the dragged card one slot short of wherever it
        // was actually dropped (it looked like every downward drag landed
        // above the card you dropped on). Dragging up is unaffected — the
        // target's index never moves when something after it is removed, so
        // "insert at the target's index" already lands right above it there.
        if(from < targetIdxBefore) to += 1;
        list.splice(to, 0, draggedId);
        renderMyXI();
        return;
      }
      // dropped onto a card in the other zone — swap the two players' zones
      if(draggedZone==='bench' && targetZoneActual==='xi'){
        draft.xi11 = draft.xi11.filter(id=>id!==targetId).concat([draggedId]);
      } else {
        draft.xi11 = draft.xi11.filter(id=>id!==draggedId).concat([targetId]);
      }
      renderMyXI();
      return;
    }

    // dropped on empty zone space
    if(draggedZone === targetZone) return;
    if(targetZone==='xi'){
      if(draft.xi11.length>=11){ showAlert('Your starting XI already has 11 — drop onto a starter to swap instead.'); return; }
      draft.xi11.push(draggedId);
    } else {
      draft.xi11 = draft.xi11.filter(id=>id!==draggedId);
    }
    renderMyXI();
  }

  /* ---- drag (and tap-to-open-detail) — one Pointer Events handler drives both ----
     Pointer Events unify mouse, trackpad and touch input, so a single
     pointerdown/move/up sequence on the card gives a real, cursor/finger-
     following drag on every device — replacing the old split between native
     HTML5 drag-and-drop (which never fires on touch at all) and a tap-to-swap
     fallback for touch. Dragging is long-press-gated: a press only turns into
     a drag once it's been held roughly still for LONG_PRESS_MS (see the timer
     in pointerdown below and beginActualDrag() firing from it), not the
     instant it moves. That's deliberate — with the whole card as the drag
     surface (nothing left on it to carve a drag-handle out of, see
     squadCardHtml's comment) and .squad-card's touch-action:pan-y (index.html)
     leaving vertical swipes to the browser by default, an ordinary scroll
     down the Starting XI/Bench list no longer gets hijacked into a drag
     partway through — only a still, held-down press does. A press that
     moves past DRAG_THRESHOLD before the timer fires is read as exactly that
     kind of scroll attempt and abandoned outright (no tap, no drag); a
     release before the timer fires without moving that far is a plain tap,
     which opens that player's detail overlay (openPlayerDetailOverlay,
     js/overlays.js) rather than arming a tap-to-swap — repositioning within/
     between zones is drag-only now that there's nothing else on the card to
     compete with a tap for meaning. */
  const DRAG_THRESHOLD = 6; // px of movement, before the long-press timer fires, that abandons a press as a scroll attempt rather than a tap
  const LONG_PRESS_MS = 350; // how long a still press has to hold before it's picked up as a drag rather than left to scroll
  let dragState = null; // {pid, zone, el, startX, startY, dragging, ghost, pointerId, timer}

  function dropTargetAt(x, y, draggedPid){
    const el = document.elementFromPoint(x, y);
    if(!el) return null;
    const overCard = el.closest('.squad-card[data-pid]');
    if(overCard && overCard.dataset.pid !== draggedPid) return {zone: overCard.dataset.zone, pid: overCard.dataset.pid, el: overCard};
    const overZone = el.closest('[data-zone-slots]');
    if(overZone) return {zone: overZone.dataset.zoneSlots, pid: null, el: overZone.closest('.squad-zone')};
    return null;
  }
  function clearDropHighlights(){
    c.querySelectorAll('.drop-hover').forEach(z=> z.classList.remove('drop-hover'));
    c.querySelectorAll('.drop-target').forEach(cd=> cd.classList.remove('drop-target'));
  }
  function beginActualDrag(){
    dragState.dragging = true;
    const source = c.querySelector(`.squad-card[data-pid="${dragState.pid}"]`);
    if(!source) return;
    source.classList.add('dragging');
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = source.getBoundingClientRect().width + 'px';
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
  }
  function positionGhost(x, y){
    if(!dragState.ghost) return;
    dragState.ghost.style.left = (x + 14) + 'px';
    dragState.ghost.style.top = (y + 14) + 'px';
  }
  function endDragVisuals(){
    if(!dragState) return;
    if(dragState.ghost) dragState.ghost.remove();
    const source = c.querySelector(`.squad-card[data-pid="${dragState.pid}"]`);
    if(source) source.classList.remove('dragging');
    clearDropHighlights();
  }

  c.querySelectorAll('.squad-card[data-pid]').forEach(card=>{
    card.addEventListener('pointerdown', e=>{
      if(e.button) return; // ignore right/middle click; touch/pen report button 0
      // No preventDefault()/setPointerCapture-as-a-scroll-blocker here — see
      // the comment above the constants: the browser stays free to scroll
      // this touch natively unless/until the long-press timer below actually
      // arms a drag. Still calling setPointerCapture is safe on its own; it
      // only routes future pointer events for this touch to this element,
      // it doesn't affect touch-action/scrolling by itself.
      e.stopPropagation();
      card.setPointerCapture(e.pointerId);
      dragState = {pid: card.dataset.pid, zone: card.dataset.zone, el: card, startX: e.clientX, startY: e.clientY, dragging: false, ghost: null, pointerId: e.pointerId, timer: null};
      dragState.timer = setTimeout(()=>{
        if(!dragState || dragState.el!==card || dragState.dragging) return; // released, moved away, or already armed since this fired
        dragState.timer = null;
        beginActualDrag();
        positionGhost(dragState.startX, dragState.startY);
      }, LONG_PRESS_MS);
    });
    card.addEventListener('pointermove', e=>{
      if(!dragState || dragState.el!==card) return;
      if(!dragState.dragging){
        // Still waiting on the long-press timer. Real movement this early
        // reads as a scroll attempt, not a hold-to-drag — let it go (the
        // browser's already free to scroll on its own, having never been
        // preventDefault()'d) rather than racing it, and abandon the press
        // entirely so release doesn't also fire a tap.
        if(Math.hypot(e.clientX-dragState.startX, e.clientY-dragState.startY) >= DRAG_THRESHOLD){
          clearTimeout(dragState.timer);
          dragState = null;
        }
        return;
      }
      e.preventDefault();
      positionGhost(e.clientX, e.clientY);
      clearDropHighlights();
      const target = dropTargetAt(e.clientX, e.clientY, dragState.pid);
      if(target) target.el.classList.add(target.pid ? 'drop-target' : 'drop-hover');
    });
    const release = e=>{
      if(!dragState || dragState.el!==card) return;
      if(dragState.timer) clearTimeout(dragState.timer);
      const {pid, zone, dragging} = dragState;
      if(dragging){
        const target = dropTargetAt(e.clientX, e.clientY, pid);
        endDragVisuals();
        dragState = null;
        if(target) moveOrSwap(pid, target.zone, target.pid);
      } else {
        // Released before the long-press armed a drag, without moving far
        // enough to look like a scroll either — a plain tap, opening this
        // player's detail overlay (see the comment on the drag handler above).
        dragState = null;
        openPlayerDetailOverlay(pid, zone);
      }
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', ()=>{
      if(dragState && dragState.el===card){
        if(dragState.timer) clearTimeout(dragState.timer);
        endDragVisuals();
        dragState = null;
      }
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
    // selector (or joined via drag/add rather than the XI's role select), so
    // what actually gets committed/locked always has an explicit role for
    // every squad member rather than relying on the fallback at score time.
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

/* Reached from the "+" at the end of the series tab strip (see
   seriesSwitcherHtml above) — picks which series to start a new team on,
   same "skip the prompt if there's only one option" shortcut
   openAddInningsOverlay (admin-match.js) uses. */
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

