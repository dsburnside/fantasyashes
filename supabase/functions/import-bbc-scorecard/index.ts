// supabase/functions/import-bbc-scorecard/index.ts
//
// Fetches a BBC Sport cricket scorecard page server-side (a plain browser
// fetch of another origin is blocked by CORS, and — unlike Cricinfo, which
// blocks automated requests outright at the CDN edge regardless of where
// they come from — BBC Sport serves this fine to a server-side fetch) and
// hands back the same structured scorecard data the page itself hydrates
// from: BBC's Simorgh framework embeds it as a JSON string in
// `window.__INITIAL_DATA__`, keyed by the API calls that built the page —
// this pulls out just the `cricket-scorecard?...` entry, so the client
// (js/admin-import.js) gets clean {innings, homeTeam, awayTeam, match} data
// rather than having to scrape rendered HTML.
//
// Deploy once with the Supabase CLI from the project root:
//   supabase functions deploy import-bbc-scorecard
// (no secrets/env vars needed — this makes no Supabase calls of its own,
// it's a pure fetch-and-reshape proxy). See SETUP.md for the one-time CLI
// login/link steps if you haven't used the CLI on this project before.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  let url: string | undefined;
  try {
    ({ url } = await req.json());
  } catch {
    return jsonResponse({ error: "Expected a JSON body with a `url` field." }, 400);
  }
  if (!url || typeof url !== "string" || !/^https:\/\/(www\.)?bbc\.co\.uk\/sport\/cricket\/scorecard\//.test(url)) {
    return jsonResponse({ error: "That doesn't look like a bbc.co.uk/sport/cricket/scorecard/... URL." }, 400);
  }
  const pageUrl = url.split("#")[0]; // the #ENG2nd-style innings tab is a client-side anchor only, never sent to the server

  let html: string;
  try {
    const res = await fetch(pageUrl, {
      headers: {
        // A plain server-to-server fetch already gets through fine here
        // (confirmed against a live scorecard while building this) — the
        // UA is set anyway since BBC's markup can differ for very old/bot
        // user agents.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return jsonResponse({ error: `BBC Sport returned HTTP ${res.status} for that URL.` }, 502);
    html = await res.text();
  } catch (e) {
    return jsonResponse({ error: `Could not reach BBC Sport: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  // window.__INITIAL_DATA__="<JSON document, JS-string-escaped>";</script>
  const marker = 'window.__INITIAL_DATA__="';
  const start = html.indexOf(marker);
  if (start === -1) {
    return jsonResponse({ error: "Couldn't find scorecard data on that page — make sure it's a BBC Sport cricket scorecard URL (bbc.co.uk/sport/cricket/scorecard/...), not a match report or summary page." }, 502);
  }
  const from = start + marker.length;
  const end = html.indexOf('";</script>', from);
  if (end === -1) {
    return jsonResponse({ error: "Found scorecard data on that page but couldn't read all of it — BBC may have changed their page format." }, 502);
  }

  let scorecard: unknown;
  try {
    // Escaped once for embedding as a JS string literal, and the string it
    // decodes to is itself a second, ordinary JSON document — wrapping in
    // quotes and re-parsing undoes the JS-literal escaping without
    // reimplementing it by hand.
    const inner = JSON.parse('"' + html.slice(from, end) + '"');
    const data = JSON.parse(inner);
    const scKey = Object.keys(data.data || {}).find((k: string) => k.startsWith("cricket-scorecard?"));
    if (!scKey) return jsonResponse({ error: "That page's data doesn't include a scorecard — double check the URL." }, 502);
    scorecard = data.data[scKey].data;
  } catch (e) {
    return jsonResponse({ error: `Could not parse BBC's scorecard data: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }

  return jsonResponse({ scorecard });
});
