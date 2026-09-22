// Drives a run through the proxy, drops the SSE mid-run, resumes with Last-Event-ID,
// and checks the reassembled stream is gap-free and duplicate-free.
import httpMod from "node:http";
import https from "node:https";
const http = process.env.KLEIO_TLS ? https : httpMod;
import { readFileSync } from "node:fs";
const T = readFileSync("/tmp/kleio-spike-token", "utf8").trim();
const SID = readFileSync("/tmp/kleio-spike-sid", "utf8").trim();
const H = { host: process.env.KLEIO_HOST ?? "127.0.0.1", port: Number(process.env.KLEIO_PORT ?? 18443) };
const auth = { "x-kleio-device-token": T, "x-gg-session": SID };

function sse(lastId, onFrame) {
  return new Promise((resolve) => {
    const headers = { ...auth, accept: "text/event-stream" };
    if (lastId != null) headers["last-event-id"] = String(lastId);
    const req = http.request({ ...H, path: `/events?session=${SID}`, headers }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, i); buf = buf.slice(i + 2);
          const id = raw.match(/^id: (\d+)$/m)?.[1];
          const data = raw.match(/^data: (.*)$/m)?.[1];
          if (id && data) onFrame(Number(id), JSON.parse(data));
        }
      });
      res.on("close", () => resolve());
    });
    req.end();
    return req;
  }).catch(() => {});
}
const post = (path, body) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const r = http.request({ ...H, path, method: "POST", headers: { ...auth, "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (u) => { let s=""; u.on("data",d=>s+=d); u.on("end",()=>res({status:u.statusCode, body:s})); });
  r.on("error", rej); r.end(data);
});

const seen = new Map(); // id -> type
const deltas = new Map(); // id -> text
let phase1Last = 0, dropped = false, done = false;
const record = (id, f) => { if (seen.has(id)) console.log("DUPLICATE id", id); seen.set(id, f.type); if (f.type==="text_delta") deltas.set(id, typeof f.data==="string"?f.data:(f.data?.text??f.data?.delta??"")); if (f.type === "agent_end" || (f.type === "state" && f.data?.runState === "idle" && seen.size > 5)) done = true; };

// Phase 1: attach, send prompt, kill the connection ~2.5 s in.
let req1;
const p1 = new Promise((resolve) => {
  const headers = { ...auth, accept: "text/event-stream" };
  req1 = http.request({ ...H, path: `/events?session=${SID}`, headers }, (res) => {
    let buf = ""; res.setEncoding("utf8");
    res.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n\n")) !== -1) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const id = raw.match(/^id: (\d+)$/m)?.[1]; const data = raw.match(/^data: (.*)$/m)?.[1]; if (id && data) { phase1Last = Number(id); record(Number(id), JSON.parse(data)); } } });
    res.on("close", resolve);
  });
  req1.on("error", resolve); req1.end();
});
await new Promise(r => setTimeout(r, 300));
console.log("prompt →", await post("/prompt", { text: "Count from 1 to 400, one number per line, no commentary, no grouping." }));
await new Promise(r => setTimeout(r, 1200));
console.log(`dropping connection after id ${phase1Last} (${seen.size} frames)`);
req1.destroy(); dropped = true;
await p1;
// Simulated 5 s outage while the run continues on the host.
await new Promise(r => setTimeout(r, 5000));
// Phase 2: resume.
const before = seen.size;
const t0 = Date.now();
await new Promise((resolve) => {
  const headers = { ...auth, accept: "text/event-stream", "last-event-id": String(phase1Last) };
  const req = http.request({ ...H, path: `/events?session=${SID}`, headers }, (res) => {
    let buf = ""; res.setEncoding("utf8");
    res.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n\n")) !== -1) { const raw = buf.slice(0, i); buf = buf.slice(i + 2); const id = raw.match(/^id: (\d+)$/m)?.[1]; const data = raw.match(/^data: (.*)$/m)?.[1]; if (id && data) { const f = JSON.parse(data); record(Number(id), f); if (f.type === "kleio_replay_gap") console.log("GAP", f.data); if (f.type === "run_end" || f.type === "agent_end" || f.type === "turn_end") { req.destroy(); } } } });
    res.on("close", resolve);
  });
  req.on("error", resolve); req.end();
  setTimeout(() => req.destroy(), 40000);
});
const ids = [...seen.keys()].sort((a, b) => a - b);
const p2 = ids.filter(id => id > phase1Last); const gaps = p2.filter((id, i) => i > 0 && id !== p2[i - 1] + 1); console.log(`phase-2 ids ${p2[0]}..${p2.at(-1)} contiguous=${gaps.length===0} first-after-drop=${p2[0]===phase1Last+1}`);
const text = [...seen.entries()].filter(([, t]) => t === "text_delta").length;
const types = [...new Set(seen.values())];
console.log(`\nframes total=${seen.size} (phase1=${before}, replayed+live=${seen.size - before}) ids ${ids[0]}..${ids.at(-1)} gaps=${JSON.stringify(gaps)} text_delta=${text}`);
console.log("types:", types.join(", "));
// Verify the transcript on the host matches what we assembled.
const hist = await new Promise((res) => { http.get({ ...H, path: "/history", headers: auth }, (u) => { let s=""; u.on("data",d=>s+=d); u.on("end",()=>res(JSON.parse(s).history)); }); });
const last = hist.at(-1); const txt = typeof last?.text === "string" ? last.text : JSON.stringify(last).slice(0, 200);
const nums = (txt.match(/\b\d+\b/g) || []).map(Number);
const streamed=[...deltas.entries()].sort((a,b)=>a[0]-b[0]).map(([,t])=>t).join("");
console.log(`streamed text == history text: ${streamed===txt} (streamed ${streamed.length} chars, history ${txt.length})`);
console.log(`history: ${hist.length} entries; last role=${last?.role} numbers found=${nums.length} first=${nums[0]} last=${nums.at(-1)} monotonic=${nums.every((n,i)=>i===0||n===nums[i-1]+1)}`);
process.exit(gaps.length ? 1 : 0);
