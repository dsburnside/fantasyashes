/* js/state.js — shared static lookups + the app's in-memory global state (players, session, drafts, etc). */
/* ================= STATIC LOOKUPS ================= */
const ROLE_LABEL = {BAT:'BAT', BOWL:'BOWL', AR:'ALL', WK:'WKT'};
// Display/grouping order for the player picker: Batters, All-rounders,
// Wicketkeepers, Bowlers.
const ROLE_GROUP_ORDER = ['BAT', 'AR', 'WK', 'BOWL'];
// A "playing role" is a per-XI-selection choice, independent of a player's own
// base role above — it decides which discipline's bonus points get doubled
// (see singleInningsPoints). Only BAT/BOWL/WK are valid playing roles; an
// all-rounder's base role isn't one of those, so it needs a default same as
// anyone else. Defaulting to their own base role covers BAT/BOWL/WK players;
// all-rounders default to BAT (arbitrary but as good as any other pick, and
// always overridable from My XI).
function defaultPlayingRole(baseRole){
  return (baseRole==='BAT' || baseRole==='BOWL' || baseRole==='WK') ? baseRole : 'BAT';
}
// Inline SVG path content (viewBox 0 0 24 24, stroke-width 1.75, round caps —
// the style guide's icon spec, wicket-style-guide.html) for the playing-role
// toggle buttons in My XI (js/myxi.js, squadCardHtml) — same Bat/Ball/Wicket
// glyphs the guide's own icon grid and the bottom nav already use, so a
// player's assigned role reads as the same iconography everywhere in the app.
const ROLE_ICON_PATH = {
  BAT: '<path d="M5 19 15 9"/><rect x="14" y="4" width="6" height="6" rx="1" transform="rotate(45 17 7)"/>',
  BOWL: '<circle cx="12" cy="12" r="8"/><path d="M8 8c2 2 6 2 8 0M8 16c2-2 6-2 8 0"/>',
  WK: '<line x1="8" y1="4" x2="8" y2="18"/><line x1="12" y1="4" x2="12" y2="18"/><line x1="16" y1="4" x2="16" y2="18"/><line x1="6" y1="4" x2="18" y2="4"/>',
};

/* ================= STATE ================= */
// My XI's player-facing state, scoped to whichever series the user is
// currently building/viewing a team for (currentSeriesId) — independent of
// leagues entirely. A team only needs a series; joining a league is a
// separate, optional step handled on the My Leagues tab.
let PLAYERS = [];
let PLAYER_MAP = {};
let fixtures = [];        // [{test, venue, date, deadline}]
let session = null;       // Supabase auth session
let isAdmin = false;      // whether the signed-in user can manage series/fixtures/players/stats
let myFirstName = '';     // signed-in user's first name (from profiles), copied onto squads.manager_name at creation
let myLastName = '';      // signed-in user's last name (from profiles)
let didInitialLoad = false; // true once init()'s own sequential first load has finished — see onAuthStateChange below

let seriesList = [];        // every series (anyone picks a team from these; admin sets up their fixtures/players)
let teamsList = [];         // every team (shared master data — a series picks two of these)
let venuesList = [];        // every venue (shared master data — a fixture picks or adds one of these)
let mySquads = [];          // every squad row (camelCase) the signed-in user holds — one per series they've picked a team for
let currentSeriesId = null; // which series My XI is currently building/showing a team for
let mySquad = null;         // the squad row (if any) for currentSeriesId

// My Leagues tab state — entirely separate from the above: which league's
// standings are being viewed can be for a different series than whatever
// team My XI currently has open.
let myLeagues = [];         // [{id, name, seriesId}] leagues the signed-in user is a member of, via league_members
let currentLeagueId = null; // which league's standings the My Leagues tab is currently showing

// Set from a ?join=CODE URL (see "Copy invite link" in renderLeaderboard()) —
// captured once at load, then applied to the "add a league" join form as soon
// as a session exists (immediately if already signed in, or once login/signup
// completes), by applyPendingJoinCode().
let pendingJoinCode = null;

// Admin-editing state — deliberately separate from the player-facing state
// above, since an admin might be setting up a series/league other than the
// one they're currently playing in themselves.
let adminSeriesId = null;   // which series the whole Admin Hub drill-down (js/admin-series.js, js/admin-match.js) is currently editing
let adminPlayers = [];
let adminPlayerMap = {};
let adminFixtures = [];

function buildPlayerMap(){ return Object.fromEntries(PLAYERS.map(p=>[p.id,p])); }
function getPlayer(id){ return PLAYER_MAP[id] || {id, name:'(removed player)', nat:'?', role:'BAT'}; }
function playerName(id){ return getPlayer(id).name; }
function fmtDate(d){
  try{ return new Date(d).toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'}); }
  catch(e){ return d; }
}
function toDatetimeLocalValue(iso){
  try{ return new Date(iso).toISOString().slice(0,16); }
  catch(e){ return ''; }
}
function slugify(name, nat, existing){
  const base = nat.toLowerCase().replace(/[^a-z0-9]+/g,'') + '_' + name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  let id = base, n = 2;
  while(existing.some(p=>p.id===id)){ id = base+'_'+n; n++; }
  return id;
}

