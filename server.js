"use strict";
/* RSA Studio local server. No npm packages needed (Node 18+).
   - GET  /api/site?url=...   reads a website and returns clean text
   - POST /api/ai             forwards a prompt to a free AI provider
   - GET  /api/status         tells the page which provider is set up */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

/* ---------- .env ---------- */
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !m[0].trim().startsWith("#") && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env yet */ }

const E = process.env;
const PORT = +E.PORT || 3000;
const PROVIDER = (E.PROVIDER || "gemini").toLowerCase();
const GAP = +E.MIN_GAP_MS || (PROVIDER === "ollama" ? 0 : 4500);
const MAX_OUT = +E.MAX_OUTPUT_TOKENS || 16384;

const P = {
  gemini: { key: E.GEMINI_API_KEY, model: E.GEMINI_MODEL || "gemini-3.8-flash" },
  groq: { key: E.GROQ_API_KEY, model: E.GROQ_MODEL || "llama-3.3-70b-versatile", base: "https://api.groq.com/openai/v1" },
  openrouter: { key: E.OPENROUTER_API_KEY, model: E.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free", base: "https://openrouter.ai/api/v1" },
  ollama: { key: "local", model: E.OLLAMA_MODEL || "llama3.1", base: E.OLLAMA_URL || "http://127.0.0.1:11434" }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(b); };
const readBody = req => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on("data", c => { n += c.length; if (n > 8e6) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

/* ---------- AI providers ---------- */
function httpErr(status, body, headers) {
  let msg = ""; try { msg = JSON.parse(body)?.error?.message || body; } catch { msg = body; }
  msg = String(msg).slice(0, 300);
  const e = new Error(msg || ("HTTP " + status));
  if (status === 429) {
    e.code = "rate_limited"; e.retry = true;
    const ra = +(headers.get("retry-after") || 0);
    const gd = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
    e.retryAfter = ra ? ra * 1000 : gd ? Math.ceil(+gd[1]) * 1000 + 500 : 0;
    if (/per\s*day|daily|quota exceeded.*day/i.test(body)) { e.retry = false; e.message = "Daily free limit reached. Try again tomorrow or switch provider in .env. " + msg; }
  } else if (status === 500 || status === 502 || status === 503 || status === 504) { e.code = "provider_error"; e.retry = true; }
  else if (status === 401 || status === 403 || (status === 400 && /api key|API_KEY/i.test(body))) e.code = "bad_key";
  else e.code = "provider_error";
  return e;
}
async function post(url, headers, body, signal) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal }); }
  catch (err) {
    if (err.name === "AbortError") throw err;
    const e = new Error("Internet connection to the AI dropped (" + (err.cause?.code || err.message) + "). Retrying..."); e.code = "provider_error"; e.retry = true; throw e;
  }
  const text = await r.text();
  if (!r.ok) throw httpErr(r.status, text, r.headers);
  try { return JSON.parse(text); } catch { const e = new Error("Provider sent a non-JSON reply"); e.code = "provider_error"; throw e; }
}
async function callProvider(prompt, signal) {
  const c = P[PROVIDER];
  if (PROVIDER === "gemini") {
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, { "x-goog-api-key": c.key },
      { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: MAX_OUT } }, signal);
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => p.text || "").join("");
    if (!text) { const e = new Error(j.promptFeedback?.blockReason ? "Blocked by provider: " + j.promptFeedback.blockReason : "Empty reply from Gemini"); e.code = "provider_error"; throw e; }
    return { text, truncated: cand?.finishReason === "MAX_TOKENS" };
  }
  if (PROVIDER === "groq" || PROVIDER === "openrouter") {
    const j = await post(c.base + "/chat/completions", { Authorization: "Bearer " + c.key },
      { model: c.model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.7, max_tokens: Math.min(MAX_OUT, 8000) }, signal);
    const ch = j.choices?.[0];
    return { text: ch?.message?.content || "", truncated: ch?.finish_reason === "length" };
  }
  if (PROVIDER === "ollama") {
    const j = await post(c.base + "/api/chat", {}, { model: c.model, messages: [{ role: "user", content: prompt }], stream: false, format: "json", options: { num_ctx: 32768, temperature: 0.7 } }, signal);
    return { text: j.message?.content || "", truncated: false };
  }
  const e = new Error("Unknown PROVIDER in .env: " + PROVIDER); e.code = "provider_error"; throw e;
}
async function withRetry(fn, signal) {
  let delay = 8000;
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (signal.aborted) { const a = new Error("cancelled"); a.code = "cancelled"; throw a; }
      if (e.name === "AbortError") { const a = new Error("cancelled"); a.code = "cancelled"; throw a; }
      console.log("[ai] attempt " + (i + 1) + " failed (" + (e.code || "error") + "): " + String(e.message).slice(0, 200));
      if (e.retry && i < 7) { await sleep(e.retryAfter || delay); delay = Math.min(delay * 2, 60000); continue; }
      throw e;
    }
  }
}
/* One request at a time, with a minimum gap, so the free limits are respected. */
let chain = Promise.resolve(), last = 0;
function schedule(fn) {
  const run = chain.then(async () => { const w = Math.max(0, last + GAP - Date.now()); if (w) await sleep(w); try { return await fn(); } finally { last = Date.now(); } });
  chain = run.catch(() => {});
  return run;
}

/* ---------- Website reader ---------- */
const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } }).replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; } });
const stripTags = h => decode(String(h).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function htmlToText(html, base) {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const desc = decode((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || "");
  const links = [], seen = new Set(); let origin = ""; try { origin = new URL(base).origin; } catch {}
  html.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, h, t) => {
    try {
      const u = new URL(h, base); u.hash = "";
      if (u.origin === origin && /^https?:$/.test(u.protocol) && !/\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js)$/i.test(u.pathname) && !seen.has(u.href)) { seen.add(u.href); links.push(`${stripTags(t) || "(link)"} -> ${u.href}`); }
    } catch {}
    return m;
  });
  let t = html.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|ul|ol|header|footer|nav|form|table|blockquote)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  t = decode(t).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  return { text: `TITLE: ${title}\nDESCRIPTION: ${desc}\n\n${t}`, links: links.slice(0, 40), bodyLen: t.length };
}
async function renderWithPlaywright(url) {
  let pw; try { pw = require("playwright"); } catch { return null; }
  let b; try {
    b = await pw.chromium.launch(); const p = await b.newPage();
    await p.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await p.content();
  } catch { return null; } finally { try { b && await b.close(); } catch {} }
}
/* Visible browser research: opens a real Chrome-like window, scrolls the home page,
   then visits the most useful inner pages (services, about, contact...). Needs Playwright. */
const VISIBLE = E.VISIBLE_BROWSER !== "0";
const MAX_PAGES = Math.max(0, +E.MAX_PAGES || 5);
const GOOD_PAGE = /service|about|contact|practice|area|pricing|price|cost|faq|team|why|location|repair|install|emergency|quote|book/i;
async function scrollPage(p) {
  try {
    await p.evaluate(async () => {
      const max = Math.min(document.body.scrollHeight, 12000);
      for (let y = 0; y < max; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); }
      window.scrollTo(0, 0);
    });
  } catch {}
}
async function openPage(p, url) {
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  try { await p.waitForLoadState("networkidle", { timeout: 8000 }); } catch {}
  /* Some sites show a "Checking your browser" screen first. Wait for it to finish (up to ~40s). */
  const CHALLENGE = /checking your browser|just a moment|verify you are human|attention required|security check/i;
  for (let i = 0; i < 20; i++) {
    let t = ""; try { t = (await p.title()) + " " + ((await p.textContent("body", { timeout: 2000 })) || "").slice(0, 400); } catch {}
    if (!CHALLENGE.test(t)) break;
    if (i === 0) console.log("[browser] The site is checking the browser. Waiting for it to finish...");
    await p.waitForTimeout(2000);
  }
  try { await p.waitForLoadState("networkidle", { timeout: 6000 }); } catch {}
  await scrollPage(p);
  return await p.content();
}
async function browseVisible(startUrl) {
  let pw; try { pw = require("playwright"); } catch { console.log("[browser] Playwright not installed, using background reading."); return null; }
  let b;
  try {
    console.log("[browser] Opening a browser window to research " + startUrl);
    const opts = { headless: false, slowMo: 120, args: ["--start-maximized", "--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"] };
    try { b = await pw.chromium.launch({ ...opts, channel: "chrome" }); }   /* your installed Google Chrome */
    catch { b = await pw.chromium.launch(opts); }                           /* fallback: Playwright Chromium */
    const ctx = await b.newContext({ viewport: null });
    const p = await ctx.newPage();
    const html = await openPage(p, startUrl);
    const finalUrl = p.url();
    const main = htmlToText(html, finalUrl);
    let text = main.text.slice(0, 10000), pages = 1;
    const cands = main.links.map(l => { const i = l.lastIndexOf(" -> "); return { label: l.slice(0, i), url: l.slice(i + 4) }; })
      .filter(l => { try { return new URL(l.url).pathname.length > 1 && GOOD_PAGE.test(l.label + " " + l.url); } catch { return false; } })
      .slice(0, MAX_PAGES);
    for (const c of cands) {
      try {
        console.log("[browser] Reading " + c.url);
        const h = await openPage(p, c.url);
        const o = htmlToText(h, p.url());
        text += `\n\n=== PAGE: ${p.url()} ===\n` + o.text.slice(0, 4000);
        pages++;
      } catch (e) { console.log("[browser] Skipped " + c.url + ": " + e.message.split("\n")[0]); }
    }
    console.log("[browser] Done. Pages read: " + pages + ", text length: " + text.length);
    if (/checking your browser|just a moment|verify you are human/i.test(text.slice(0, 600))) console.log("[browser] WARNING: the site still showed its security check. Paste the page text into 'Website content' instead.");
    return { url: finalUrl, text: text.slice(0, 30000), thin: text.length < 500, rendered: true, pages };
  } catch (e) {
    console.log("[browser] Could not open the browser: " + e.message.split("\n")[0] + "\n[browser] If it says the executable is missing, run: npx playwright install chromium");
    return null;
  } finally { try { b && await b.close(); } catch {} }
}
async function readSite(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http/https links");
  if (VISIBLE) { const v = await browseVisible(u.href); if (v) return v; }
  const r = await fetch(u.href, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } });
  if (!r.ok) throw new Error("Site answered HTTP " + r.status);
  let html = await r.text(), out = htmlToText(html, r.url), rendered = false;
  if (out.bodyLen < 500) { const h2 = await renderWithPlaywright(r.url); if (h2) { out = htmlToText(h2, r.url); rendered = true; } }
  const text = (out.text + (out.links.length ? "\n\nPAGE LINKS:\n" + out.links.join("\n") : "")).slice(0, 30000);
  return { url: r.url, text, thin: out.bodyLen < 500, rendered };
}

/* ---------- HTTP ---------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  try {
    if (u.pathname === "/api/status") { const c = P[PROVIDER]; return send(res, 200, { provider: PROVIDER, model: c?.model, hasKey: !!c?.key }); }
    if (u.pathname === "/api/site" && req.method === "GET") {
      try { return send(res, 200, await readSite(u.searchParams.get("url") || "")); }
      catch (e) { return send(res, 502, { code: "site_error", message: e.cause?.code || e.message }); }
    }
    if (u.pathname === "/api/ai" && req.method === "POST") {
      const c = P[PROVIDER];
      if (!c) return send(res, 400, { code: "provider_error", message: "Unknown PROVIDER in .env" });
      if (!c.key) return send(res, 400, { code: "no_key", message: "No API key for " + PROVIDER });
      let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { code: "provider_error", message: "Bad request" }); }
      const ac = new AbortController(); res.on("close", () => { if (!res.writableEnded) ac.abort(); });
      try {
        const out = await schedule(() => ac.signal.aborted ? Promise.reject(Object.assign(new Error("cancelled"), { code: "cancelled" })) : withRetry(() => callProvider(String(body.prompt || ""), ac.signal), ac.signal));
        return send(res, 200, out);
      } catch (e) { console.log("[ai] ERROR (" + (e.code || "provider_error") + "): " + e.message); if (!res.writableEnded) send(res, e.code === "bad_key" ? 401 : e.code === "rate_limited" ? 429 : 502, { code: e.code || "provider_error", message: e.message }); return; }
    }
    /* static files */
    let rel = decodeURIComponent(u.pathname); if (rel === "/") rel = "/index.html";
    const file = path.join(__dirname, "public", path.normalize(rel).replace(/^([/\\]*\.\.)+/, ""));
    if (!file.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end("Not found"); } res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" }); res.end(data); });
  } catch (e) { if (!res.headersSent) send(res, 500, { code: "provider_error", message: e.message }); }
});
server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`, c = P[PROVIDER];
  console.log(`\nRSA Studio is running: ${url}`);
  console.log(`AI provider: ${PROVIDER} (${c?.model || "?"}) · key ${c?.key ? "found" : "MISSING: open the .env file and paste it"}\nStop with Ctrl+C.\n`);
  if (E.OPEN_BROWSER !== "0") exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`, () => {});
});
