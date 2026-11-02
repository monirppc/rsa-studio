"use strict";
/* Lets the RSA Studio page run outside Claude. It provides the same
   claude.use("sample" | "db" | "user" | "downloads") calls the page expects:
   AI goes to the local server, saved projects go to this browser's storage. */
(function () {
  window.LOCAL_MODE = true;

  async function post(path, body, signal) {
    let r;
    try { r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (e) { if (e && e.name === "AbortError") throw { code: "cancelled" }; throw { code: "server_down", message: "Local server isn't running. Start the app again." }; }
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) throw { code: (j && j.code) || "provider_error", message: (j && j.message) || "HTTP " + r.status };
    return j;
  }
  function parseJSON(t) {
    t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(t); } catch {}
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
    return null;
  }
  const toPrompt = input => typeof input === "string" ? input : (Array.isArray(input) ? input.map(m => m.content).join("\n\n") : String(input));

  const sample = async function (input, opts = {}) {
    if (opts.signal && opts.signal.aborted) throw { code: "cancelled" };
    const j = await post("/api/ai", { prompt: toPrompt(input), tier: opts.modelTier || "default" }, opts.signal);
    if (opts.onText) opts.onText({ text: j.text, delta: j.text });
    return { text: j.text, truncated: !!j.truncated };
  };
  sample.json = async function (input, opts = {}) {
    const j = await sample(input, opts);
    const v = parseJSON(j.text);
    if (v == null) throw { code: "invalid_json", text: j.text };
    return v;
  };
  sample.limits = async () => ({ images: false });

  /* Small localStorage-backed stand-in for the db the page uses. */
  const KEY = "rsa_studio_db_v1", listeners = new Map();
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { throw { code: "quota_exceeded" }; } };
  const snap = col => ({ docs: Object.entries(load()[col] || {}).map(([id, v]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(v)) })) });
  const notify = col => (listeners.get(col) || []).forEach(fn => { try { fn(snap(col)); } catch {} });
  const db = {
    collection(col) {
      return {
        doc(id) {
          return {
            async get() { const v = (load()[col] || {})[id]; return { exists: v !== undefined, id, data: () => v === undefined ? undefined : JSON.parse(JSON.stringify(v)) }; },
            async set(v) { const d = load(); (d[col] = d[col] || {})[id] = JSON.parse(JSON.stringify(v)); save(d); notify(col); },
            async delete() { const d = load(); if (d[col]) delete d[col][id]; save(d); notify(col); }
          };
        },
        onSnapshot(fn) { if (!listeners.has(col)) listeners.set(col, []); listeners.get(col).push(fn); setTimeout(() => fn(snap(col)), 0); return () => { listeners.set(col, listeners.get(col).filter(f => f !== fn)); }; }
      };
    }
  };
  const user = { id: async () => "local" };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? "text/csv;charset=utf-8" : "text/plain" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  };
  const caps = { sample, db, user, downloads };
  window.claude = { use: async name => caps[name] || null };
})();
