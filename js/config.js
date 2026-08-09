/* js/config.js — Supabase client setup. Loads first; nothing else works without it. */
/* ============================================================
   CONFIG — paste your own Supabase project values here.
   Project Settings → API in your Supabase dashboard.
   ============================================================ */
const SUPABASE_URL = 'https://ytrjksnzzmuwjvziywqo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F63dU3b1GnW9YXUB0rqmBQ_wFqVVzWy';

const supabaseClient = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

