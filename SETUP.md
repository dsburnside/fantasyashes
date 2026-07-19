# Setting up your Ashes Fantasy XI backend

The app is now a static HTML file that talks directly to a free Supabase project —
there's no server for you to run or deploy. Supabase gives you a real Postgres
database, real accounts (hashed passwords, sessions), and an auto-generated API,
all on the free tier.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free, no card required).
2. Click **New project**. Pick any name and a database password (save it somewhere —
   you won't need it day-to-day, but you'd need it for direct DB access later).
3. Wait ~2 minutes for the project to spin up.

## 2. Run the schema

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase-schema.sql` (included alongside this guide), copy the whole file,
   paste it in, and click **Run**.
3. This creates four tables (`players`, `fixtures`, `match_stats`, `squads`), sets
   up row-level security so people can only edit their own squad, adds the one
   shared `lock_test()` action used by Match Centre, and seeds the player pool and
   placeholder fixtures.

## 3. Turn off email confirmation (recommended for a hobby league)

By default Supabase makes new users click a confirmation link before they can log
in, which means you'd need real email delivery set up. For a small group of
friends, it's simpler to switch it off:

- **Authentication** → **Providers** → **Email** → turn off **Confirm email**.

You can leave it on instead if you'd rather people verify their address — just
know that sign-up won't work until they click the emailed link.

## 4. Get your API keys

- **Project Settings** → **API**.
- Copy the **Project URL** and the **anon / public** key (not the `service_role`
  key — that one must never go in client-side code).

## 5. Paste them into the app

Open `ashes-fantasy-xi.html`, find this near the top of the `<script>` block:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both placeholders with the values from step 4, save, and open the file in
a browser.

## 6. Host it somewhere real (optional but recommended)

Opening the HTML file locally works fine for testing, but for a shareable link,
drag-and-drop the single file onto any static host — [Netlify Drop](https://app.netlify.com/drop),
[Cloudflare Pages](https://pages.cloudflare.com), or [Vercel](https://vercel.com)
all have free tiers that work with a single static file.

## 7. Make yourself an admin (needed for the Players tab)

The Players tab (add/edit/remove players) is now restricted to admin accounts.
Nobody is an admin by default — you grant it yourself, directly in the database:

1. Sign up for an account in the app first, so your user exists.
2. In Supabase, go to **Table Editor** → **profiles**, find the row with your
   `user_id` (match it against **Authentication** → **Users** to see which
   email it belongs to), and set `is_admin` to `true`. Or run this in the SQL
   Editor, swapping in your email:

   ```sql
   update public.profiles
   set is_admin = true
   where user_id = (select id from auth.users where email = 'you@example.com');
   ```

3. Log out and back in (or just refresh) in the app — the Players tab will now
   appear for you. Everyone else won't see it at all.

You already ran the schema once — it's safe to run the whole updated
`supabase-schema.sql` again if you pulled a newer copy; every statement is
written to skip anything that already exists.

## What changed since the last version

- **Automatic substitutions.** Admin → Match Setup now has a "Playing XI &amp;
  automatic substitutions" panel: tick which of the 28 pool players actually
  took the field for a given Test once the real teams are announced. Any
  fantasy team whose locked XI includes someone who wasn't ticked gets that
  player automatically replaced by their first bench player (in squad order)
  who was, mirroring Fantasy Premier League's autosubs. If a captain didn't
  play, the armband's 2x bonus passes to the vice-captain instead (only lost
  entirely if neither played). A Test with nothing ticked yet scores as
  before — no subs are applied until you fill it in. **This needs the schema
  re-run** — it adds a `playing_xi` column to `match_stats`, safe to run
  alongside your existing data.
- **Squad Builder is gone as a separate tab — it's all in My XI now.** Whether
  you're building your squad for the first time or managing it mid-series,
  it's the same interface: an 11-slot Starting XI zone and a 3-slot Bench
  zone, populated one player at a time.
- **Drag and drop** moves players between Starting XI and Bench — drag onto
  an empty slot to move them there, or onto another player to swap the two.
  This is always free and never counts as a transfer.
- **"Replace" opens a lightbox**: choose England or Australia, then pick from
  whoever's left unselected in that nation. The same lightbox is used for
  filling an empty slot (no player to replace yet) and for transfers (2 per
  Test, or unlimited with the wildcard armed).
- Captain and Vice-Captain are now set by clicking the **C** / **V** buttons
  directly on a player's card, instead of separate dropdowns.
- No more separate "finished squad" preview — the editable grid *is* the
  view. Commit and Wildcard live together in one action bar rather than
  scattered across separate cards.
- Note on drag-and-drop: it uses the browser's native drag API, which works
  well with a mouse but has inconsistent support for touch/mobile dragging.
  The "Replace" lightbox works everywhere regardless, including on mobile.

- **"Swaps" are now proper transfers, FPL-style.** A transfer changes who's in
  your 14-man squad (bringing in anyone from the pool, not just your existing
  players) and is limited to 2 per Test, measured against your last locked
  squad. Picking your **starting XI** from whichever 14 you currently hold is
  completely free and unlimited — it never counts as a transfer, matching how
  Fantasy Premier League separates the two.
- This needed a schema change: the old per-XI baseline columns are replaced
  with a single `baseline_squad14`, since limits are now tracked on the
  14-man squad rather than the starting XI. **Re-run `supabase-schema.sql`**
  — it drops the old columns and backfills the new one automatically.
- Swaps & Wildcard is part of My XI, not a separate tab. Editing works as a
  draft: transfer players, change your XI, change captain/VC, and nothing
  counts until you hit **Commit changes**. Commit as many times as you like
  before the deadline.
- **Revert to last committed squad** undoes any uncommitted draft edits in one
  click — the app always remembers your last locked squad specifically so
  this works.
- **Wildcard is a real toggle, not an instant spend.** Arming it lifts the
  2-transfer cap; it's only actually consumed if you commit while it's armed
  *and* your squad is still locked in that way when a Test locks. Arming it
  and backing out (via "Cancel wildcard") costs nothing.
- **Everything admin-related now lives under one "Admin" tab**, nested into
  three sections: **Series Setup** (fixtures), **Match Setup** (stats entry +
  locking a Test), and **Player Setup** (the player pool). The whole tab is
  hidden from the nav for non-admins, and the database now rejects writes to
  fixtures, match stats, players, and the Test-locking action from anyone
  who isn't an admin — not just the UI, the actual permissions.
- **Colour contrast pass.** Two real WCAG failures were found and fixed: muted
  helper text and secondary buttons both used light-on-light colours when they
  landed on the app's light cards (as low as 1.26:1). Both now meet AA
  (4.5:1+) everywhere they appear, light background or dark.
- **Players tab is admin-only.** Gated both in the UI (the tab is hidden for
  everyone else) and in the database (row-level security rejects writes from
  non-admins even if someone calls the API directly).
- **Custom overlay replaces browser `alert`/`confirm`/`prompt`.** Every popup
  in the app now matches the honours-board look instead of a plain browser
  dialog, and the login form appears as a dismissible overlay on page load
  instead of living in the header.
- **Squad-creation bug fixed.** Creating your first squad could fail with a
  foreign key error if your session was stale; squad creation now re-verifies
  your login immediately before writing, and failures show a clear "log out
  and back in" message instead of a raw database error.
- **Real accounts.** Sign up with an email + password; Supabase hashes and
  stores it properly, not the plain-text PIN the original version used.
- **One squad per account**, tied to your login rather than a typed team name.
- **Shared pool, fixtures and results** (players, fixtures, match stats) are
  readable by everyone; players can only be edited by admins (see step 7
  above), fixtures and match stats by any signed-in user.
- **Match Centre's "lock a Test"** now runs as a database function so it can
  safely snapshot every player's squad at once, while normal squad edits
  (swaps, captain changes) are still restricted to their owner.
