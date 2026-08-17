/* js/myxi.js — the My XI tab: squad building, XI/bench drag-drop, captain/VC/playing-role assignment, commit flow. */
/* ================= MY XI ================= */
let draft = null; // local, unsaved editing state for My XI: {_squadId, squad14, xi11, captain, viceCaptain, playingRoles}
// Tap-to-swap is the touch-friendly equivalent of dragging a squad-card onto
// another one — native HTML5 drag-and-drop (used elsewhere in this editor)
// never fires on touch devices, so this is the only way to move a player
// between XI and bench (or reorder within the bench) on mobile. Holds the pid
// of the card tapped first; tapping a second card completes the move via the
// same moveOrSwap() the drag handlers use — same zone reorders in place,
// other zone swaps zones.
let moveSelectedPid = null;

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

function squadCardHtml(id, zone, baselineSquad14){
  const p = getPlayer(id);
  const isCap = id===draft.captain, isVc = id===draft.viceCaptain;
  const isNew = !baselineSquad14.includes(id);
  const capVcControls = zone==='xi' ? `
    <button type="button" data-action="cap" data-pid="${id}" class="${isCap?'active-cap':''}" title="Make captain">C</button>
    <button type="button" data-action="vc" data-pid="${id}" class="${isVc?'active-vc':''}" title="Make vice-captain">V</button>` : '';
  // Playing role: only assignable while in the XI (it only ever affects live
  // scoring), independent of the player's own base role above. Defaults to
  // that base role (all-rounders default to Batter) until explicitly changed.
  const assignedRole = assignedPlayingRole(id);
  const roleSelect = zone==='xi' ? `
    <select class="role-select" data-action="role" data-pid="${id}" title="Playing role — doubles that discipline's bonus points while they're in the XI">
      ${ROLE_GROUP_ORDER.filter(r=>r!=='AR').map(r=>`<option value="${r}" ${assignedRole===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}
    </select>` : '';
  const playingAsTag = (zone==='xi' && assignedRole!==p.role) ? ` &middot; playing as ${ROLE_LABEL[assignedRole]}` : '';
  return `
    <div class="squad-card${id===moveSelectedPid?' move-selected':''}" draggable="true" data-pid="${id}" data-zone="${zone}">
      <button type="button" class="squad-card-drag-handle" data-action="movehandle" data-pid="${id}" data-zone="${zone}" title="Drag to move, or tap to swap" aria-label="Move or swap ${p.name}">&#10021;</button>
      <div class="squad-card-info">
        <div class="squad-card-name">${isCap?'<span class="honours-star">&#9733;</span>':''}${p.name}${isVc?' <span style="font-family:var(--font-mono); font-size:9.5px;">VC</span>':''}${isNew?' <span style="color:var(--gilt-bright); font-family:var(--font-mono); font-size:9px;">NEW</span>':''}</div>
        <div class="squad-card-tags">${p.nat} &middot; ${ROLE_LABEL[p.role]}${playingAsTag}</div>
      </div>
      <div class="squad-card-controls">
        ${roleSelect}
        ${capVcControls}
        <button type="button" data-action="replace" data-pid="${id}" data-zone="${zone}" title="Replace this player">&#8646;</button>
      </div>
    </div>`;
}
function emptySlotHtml(zone){
  return `<button type="button" class="squad-card empty" data-empty-zone="${zone}" data-action="add" data-zone="${zone}">+ Add player</button>`;
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
  const draftBench = draft.squad14.filter(id=>!draft.xi11.includes(id));
  const draftDiffersFromCommitted = !squad ? draft.squad14.length>0 :
    JSON.stringify([...draft.squad14].sort()) !== JSON.stringify([...squad.squad14].sort()) ||
    JSON.stringify([...draft.xi11].sort()) !== JSON.stringify([...squad.xi11].sort()) ||
    draft.captain !== squad.captain || draft.viceCaptain !== squad.viceCaptain;
  const newSeriesOptions = seriesList.filter(s=> s.id!==currentSeriesId && !mySquads.some(sq=>sq.seriesId===s.id));
  const seriesSwitcherHtml = (mySquads.length>0 || newSeriesOptions.length>0) ? `
    <div class="card" style="margin-bottom:16px;">
      <label class="field-label">Your team</label>
      <select class="pick" id="seriesSwitchSelect" style="max-width:340px; display:block; margin-top:4px;">
        ${mySquads.map(s=>{
          const sname = (seriesList.find(x=>x.id===s.seriesId)||{}).name || 'Unknown series';
          return `<option value="${s.seriesId}" ${s.seriesId===currentSeriesId?'selected':''}>${sname} &mdash; ${s.teamName}</option>`;
        }).join('')}
        ${isBuilding ? `<option value="${currentSeriesId}" selected>${activeSeries.name} &mdash; new team</option>` : ''}
        ${newSeriesOptions.length ? `<optgroup label="Start a new team">${newSeriesOptions.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</optgroup>` : ''}
      </select>
    </div>
  ` : '';

  const xiSlotsHtml = Array.from({length:11}, (_,i)=> draft.xi11[i] ? squadCardHtml(draft.xi11[i], 'xi', baselineSquad14) : emptySlotHtml('xi')).join('');
  const benchSlotsHtml = Array.from({length:3}, (_,i)=> draftBench[i] ? squadCardHtml(draftBench[i], 'bench', baselineSquad14) : emptySlotHtml('bench')).join('');

  c.innerHTML = `
    ${seriesSwitcherHtml}
    ${!isBuilding ? `
      <div class="team-name-row" style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
        <span style="font-family:var(--font-display); font-size:17px;">${squad.teamName}</span>
        <button type="button" class="btn secondary small" id="renameTeamBtn">Rename</button>
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
    <p class="panel-sub">${isBuilding
      ? `Build your 14-man squad for ${activeSeries.name}: add players, arrange your starting XI, assign each XI player a playing role, set a captain and vice-captain, then commit.`
      : !hasLockedOnce
        ? "No transfer limit yet — chop and change as much as you like right up to the first Test's deadline. The 2-transfer limit starts from the window after that."
        : "Drag players between XI and bench anytime — that's always free. Commit any time to declare your squad for the upcoming Test; only the deadline actually evaluates your transfer count."}</p>

    ${isBuilding ? `
      <div class="card" style="margin-bottom:16px;">
        <label class="field-label">Team name</label>
        <input type="text" id="teamNameField" placeholder="e.g. Bodyline Bandits" maxlength="30" value="${window.__pendingTeamName||''}" style="width:100%; max-width:360px; padding:9px; border:1px solid var(--parchment-dim); border-radius:5px;">
        <p class="muted-on-light" style="font-size:12px; margin-top:6px;">Must be unique within ${activeSeries.name} — no league required to build this, though joining one under My Leagues lets you compare against friends.</p>
      </div>
    ` : ''}

    ${!isBuilding && hasLockedOnce ? `
      <div class="swap-status-row">
        <div class="status-chip"><div class="label">Transfers vs last locked squad</div><div class="value">${transfers} / 2</div></div>
      </div>
      ${overLimit && !squad.wildcardActiveNow ? `<div class="notice warn">This draft differs from your last locked squad by <strong>${transfers} players</strong> — more than the free 2. You can still commit and preview it, but you'll want to arm your wildcard or trim it back to 2 before the deadline: the league rule is enforced by whoever locks the Test, not automatically by this notice.</div>` : ''}
    ` : ''}
    ${draftDiffersFromCommitted ? `<div class="notice">You have uncommitted changes below — they won't count for scoring until you hit <strong>Commit changes</strong>.</div>` : ''}
    ${moveSelectedPid ? `<div class="notice">Tap another player to swap places with ${getPlayer(moveSelectedPid).name} — or tap the &#10021; handle again to cancel.</div>` : ''}

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

    <div class="action-bar-main">
      <div class="action-bar-buttons">
        <button class="btn secondary" id="revertBtn">${isBuilding ? 'Clear all' : 'Revert to last committed squad'}</button>
        <button class="btn" id="commitBtn" ${canCommit?'':'disabled'}>${isBuilding ? 'Create squad' : 'Commit changes'}</button>
      </div>
    </div>
    ${(draft.squad14.length>0 && squad14Check.errors.length) || (xiFull && !xiHasWK) ? `
      <div class="notice-stack">
        ${draft.squad14.length>0 ? squad14Check.errors.map(e=>`<div class="notice warn">${e}</div>`).join('') : ''}
        ${xiFull && !xiHasWK ? `<div class="notice warn">Your starting XI needs someone assigned as wicketkeeper — set it from the role dropdown on one of your XI cards.</div>` : ''}
      </div>
    ` : ''}
    ${!isBuilding ? `<div class="action-bar-secondary"><button class="btn danger" id="resetSquadBtn">Reset team entirely</button></div>` : ''}
  `;

  const seriesSwitchSelect = c.querySelector('#seriesSwitchSelect');
  if(seriesSwitchSelect) seriesSwitchSelect.addEventListener('change', ()=> switchToSeries(seriesSwitchSelect.value));

  /* ---- persist team name field across re-renders (every card action re-renders this panel) ---- */
  const teamNameFieldEl = document.getElementById('teamNameField');
  if(teamNameFieldEl){
    teamNameFieldEl.addEventListener('input', ()=>{ window.__pendingTeamName = teamNameFieldEl.value; });
  }

  /* ---- card action buttons: captain / vice-captain / replace / add ---- */
  c.querySelectorAll('[data-action="cap"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const pid = btn.dataset.pid;
      draft.captain = (draft.captain===pid) ? null : pid;
      if(draft.viceCaptain===draft.captain) draft.viceCaptain = null;
      renderMyXI();
    });
  });
  c.querySelectorAll('[data-action="vc"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const pid = btn.dataset.pid;
      draft.viceCaptain = (draft.viceCaptain===pid) ? null : pid;
      if(draft.captain===draft.viceCaptain) draft.captain = null;
      renderMyXI();
    });
  });
  c.querySelectorAll('[data-action="role"]').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      draft.playingRoles[sel.dataset.pid] = sel.value;
      renderMyXI();
    });
  });
  c.querySelectorAll('[data-action="replace"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const outId = btn.dataset.pid;
      openPlayerPicker(draft.squad14, (newId)=>{
        const newSquad14 = draft.squad14.filter(id=>id!==outId).concat([newId]);
        // Belt-and-braces: the picker already greys out infeasible candidates
        // (via the countBasisIds arg below), this just catches it if that
        // ever falls out of sync.
        const check = validateSquad14(newSquad14);
        if(!check.valid){
          showAlert(`That would leave your squad invalid: ${check.errors.join(' ')}`, "Can't make that change");
          return;
        }
        draft.squad14 = newSquad14;
        if(draft.xi11.includes(outId)){
          const proposedXi = draft.xi11.filter(id=>id!==outId).concat([newId]);
          draft.xi11 = proposedXi.some(id=>assignedPlayingRole(id)==='WK') ? proposedXi : draft.xi11.filter(id=>id!==outId);
        }
        if(draft.captain===outId) draft.captain = null;
        if(draft.viceCaptain===outId) draft.viceCaptain = null;
        delete draft.playingRoles[outId];
        if(moveSelectedPid===outId) moveSelectedPid = null;
        renderMyXI();
      }, draft.squad14.filter(id=>id!==outId));
    });
  });
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
        // Bench order matters (it's the substitute priority queue), so this is
        // how you set it; XI order is cosmetic but reordering is harmless.
        const from = draft.squad14.indexOf(draggedId);
        if(from===-1) return;
        draft.squad14.splice(from, 1);
        const to = draft.squad14.indexOf(targetId);
        draft.squad14.splice(to, 0, draggedId);
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

  c.querySelectorAll('.squad-card[draggable="true"]').forEach(card=>{
    card.addEventListener('dragstart', e=>{
      e.dataTransfer.setData('text/plain', card.dataset.pid);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    card.addEventListener('dragover', e=> e.preventDefault());
    card.addEventListener('drop', e=>{
      e.preventDefault(); e.stopPropagation();
      moveOrSwap(e.dataTransfer.getData('text/plain'), card.dataset.zone, card.dataset.pid);
    });
  });
  c.querySelectorAll('[data-zone-slots]').forEach(zoneEl=>{
    zoneEl.addEventListener('dragover', e=>{ e.preventDefault(); zoneEl.closest('.squad-zone').classList.add('drop-hover'); });
    zoneEl.addEventListener('dragleave', ()=> zoneEl.closest('.squad-zone').classList.remove('drop-hover'));
    zoneEl.addEventListener('drop', e=>{
      e.preventDefault();
      zoneEl.closest('.squad-zone').classList.remove('drop-hover');
      moveOrSwap(e.dataTransfer.getData('text/plain'), zoneEl.dataset.zoneSlots, null);
    });
  });

  // Tap-to-swap — see moveSelectedPid comment above. First tap arms a card,
  // second tap completes the same move the drag handlers above perform
  // (reorder if it's another card in the same zone, swap if the other zone);
  // tapping the armed card again cancels.
  c.querySelectorAll('[data-action="movehandle"]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const pid = btn.dataset.pid;
      if(moveSelectedPid === pid){
        moveSelectedPid = null;
      } else if(moveSelectedPid){
        moveOrSwap(moveSelectedPid, btn.dataset.zone, pid);
        moveSelectedPid = null;
      } else {
        moveSelectedPid = pid;
      }
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
  document.getElementById('revertBtn').addEventListener('click', async ()=>{
    moveSelectedPid = null;
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
  document.getElementById('commitBtn').addEventListener('click', async ()=>{
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

