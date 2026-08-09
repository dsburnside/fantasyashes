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
      : `Joined ${league.name} — you don't have a team on this series yet. Pick one in My XI to appear on the leaderboard.`, 'Joined');
  });
}


/* ================= LEADERBOARD ================= */
async function renderLeaderboard(){
  const c = document.getElementById('leaderboardContent');
  if(!supabaseClient){ c.innerHTML = `<div class="empty-state">Configure Supabase first.</div>`; return; }
  if(!session){ c.innerHTML = `<div class="empty-state"><div class="big">Log in to see My Leagues</div></div>`; return; }

  // Everything below only ever touches #leaderboardBody, not the whole panel —
  // wireLeagueTabs() below attaches listeners to the tab strip once, and
  // reassigning c.innerHTML afterward (e.g. via +=) would silently detach them.
  c.innerHTML = `
    <h2 class="panel-title">My Leagues</h2>
    <p class="panel-sub">Standings for whichever league you're viewing — tap a tab to switch, or add one with the +.</p>
    ${leagueTabsHtml()}
    <div id="leaderboardBody"><div class="empty-state">Loading leaderboard&hellip;</div></div>
  `;
  wireLeagueTabs(c);
  const body = document.getElementById('leaderboardBody');

  const league = myLeagues.find(l=>l.id===currentLeagueId);
  if(!league){
    body.innerHTML = myLeagues.length===0
      ? `<div class="empty-state"><div class="big">No leagues yet</div>Tap the + above to create one or join with a code.</div>`
      : `<div class="empty-state">Pick a league above to see its standings.</div>`;
    return;
  }

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

  // Squads no longer belong to a single league (the same squad can back
  // multiple leagues on one series), so the leaderboard has to fetch this
  // league's actual membership first, then only the matching squads.
  const {data: memberRows, error: memberErr} = await supabaseClient.from('league_members').select('user_id').eq('league_id', league.id);
  if(memberErr){ body.innerHTML = `<div class="empty-state">Could not load leaderboard: ${memberErr.message}</div>`; return; }
  const memberIds = (memberRows||[]).map(m=>m.user_id);

  let squadRows = [];
  if(memberIds.length>0){
    const {data, error} = await supabaseClient.from('squads').select('*').eq('series_id', league.seriesId).in('user_id', memberIds);
    if(error){ body.innerHTML = `<div class="empty-state">Could not load leaderboard: ${error.message}</div>`; return; }
    squadRows = data || [];
  }
  if(squadRows.length===0){
    body.innerHTML = `<div class="card">${cardHeadHtml}<div class="empty-state"><div class="big">No teams yet</div>Build a squad to appear on the board.</div>${actionBarHtml}</div>`;
    wireActionBar();
    return;
  }

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

  const rows = squadRows.map(rowRaw=>{
    const squad = rowToSquad(rowRaw);
    let total = 0;
    const byTest = {};
    Object.keys(squad.lockedXiByTest||{}).forEach(t=>{
      const lockedEntry = squad.lockedXiByTest[t];
      const {stats, playingXi} = matchDataByTest[t] || {stats:{}, playingXi:[]};
      const pts = computeTestScore(lockedEntry, stats, playingXi);
      const {effectiveXi, captainDidNotPlay} = resolveEffectiveXi(lockedEntry, playingXi);
      const subs = effectiveXi.filter(e=>e.subFor).map(e=>({out:e.subFor, in:e.pid}));
      byTest[t] = {pts, subs, captainDidNotPlay};
      total += pts;
    });
    return {name: squad.teamName, managerName: squad.managerName, total: Math.round(total*10)/10, byTest};
  });
  rows.sort((a,b)=> b.total - a.total);

  body.innerHTML = `
    <div class="card">
      ${cardHeadHtml}
      ${rows.map((r,i)=>`
        <div class="player-row standing-row${i===0?' leader':''}" data-idx="${i}">
          <div class="player-name-wrap">
            <span class="standing-rank">${i+1}</span>
            <span class="player-name">${r.name}</span>
            ${r.managerName ? `<span class="muted-on-light" style="width:100%; font-size:11px; padding-left:26px;">${r.managerName}</span>` : ''}
          </div>
          <span class="standing-points">${r.total} pts</span>
        </div>
        <div class="standing-detail" id="standingDetail-${i}">
          ${Object.keys(r.byTest).length===0 ? 'No Tests locked yet for this team.' :
            `<table>${Object.keys(r.byTest).sort((a,b)=>a-b).map(t=>{
              const d = r.byTest[t];
              const notes = [
                ...d.subs.map(s=> `${leaguePlayerName(s.out)} &rarr; ${s.in ? leaguePlayerName(s.in) : 'no replacement available'} (auto-sub)`),
                ...(d.captainDidNotPlay ? [`Captain didn't play — armband passed to vice-captain`] : []),
              ];
              const noteHtml = notes.length ? `<div style="font-size:11px; opacity:.75; margin-top:2px;">${notes.join('<br>')}</div>` : '';
              return `<tr><td>Test ${t}${noteHtml}</td><td>${d.pts} pts</td></tr>`;
            }).join('')}</table>`}
        </div>
      `).join('')}
      ${actionBarHtml}
    </div>
  `;

  body.querySelectorAll('.standing-row').forEach(row=>{
    row.addEventListener('click', ()=> document.getElementById('standingDetail-'+row.dataset.idx).classList.toggle('open'));
  });
  wireActionBar();
}
