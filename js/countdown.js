/* js/countdown.js — the next-deadline countdown strip. */
/* ================= COUNTDOWN ================= */
function nextDeadline(){
  const now = new Date();
  return fixtures
    .map(f=>({...f, dl:new Date(f.deadline)}))
    .filter(f=> f.dl > now)
    .sort((a,b)=> a.dl - b.dl)[0] || null;
}
function startCountdown(){ renderCountdown(); setInterval(renderCountdown, 1000); }
function renderCountdown(){
  const box = document.getElementById('countdownStrip');
  if(!currentLeagueId){
    box.innerHTML = `<span class="countdown-meta">Join a league in My XI to see its Test countdown.</span>`;
    return;
  }
  const nd = nextDeadline();
  if(!nd){
    box.innerHTML = `<span class="countdown-meta">No upcoming lock deadlines — fixtures are edited under Admin &rarr; Series Setup.</span>`;
    return;
  }
  const diff = Math.max(0, nd.dl - new Date());
  const d = Math.floor(diff/86400000);
  const h = Math.floor(diff%86400000/3600000);
  const m = Math.floor(diff%3600000/60000);
  const sec = Math.floor(diff%60000/1000);
  box.innerHTML = `
    <span class="countdown-label">Selection locks &mdash; Test ${nd.test}, ${nd.venue}</span>
    <div class="countdown-clock">
      <div class="seg"><div class="n">${d}</div><div class="u">DAYS</div></div>
      <div class="seg"><div class="n">${String(h).padStart(2,'0')}</div><div class="u">HRS</div></div>
      <div class="seg"><div class="n">${String(m).padStart(2,'0')}</div><div class="u">MIN</div></div>
      <div class="seg"><div class="n">${String(sec).padStart(2,'0')}</div><div class="u">SEC</div></div>
    </div>
    <span class="countdown-meta">10:00am, ${fmtDate(nd.date)}</span>
  `;
}

