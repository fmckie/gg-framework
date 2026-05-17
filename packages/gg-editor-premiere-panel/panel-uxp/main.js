/* eslint-disable */
/**
 * GG Editor UXP plugin entrypoint.
 *
 * UXP plugins cannot listen on TCP ports. So instead of being an HTTP
 * server like the CEP panel, this plugin is a **WebSocket client**: it
 * dials out to the ggeditor CLI's localhost WS server, sends a hello
 * frame, and then handles RPC requests on the same connection.
 *
 * Wire protocol (matches PremiereWsBridge in @kenkaiiii/gg-editor):
 *
 *   plugin → server (once, on connect):
 *     { kind: "hello", product, panelKind: "uxp", version }
 *
 *   server → plugin:
 *     { id: "1", method: "get_timeline", params: {} }
 *
 *   plugin → server:
 *     { id: "1", ok: true, result: ... }
 *     { id: "1", ok: false, error: "..." }
 *
 * Reconnection uses exponential backoff capped at 5s — handles the case
 * where the user starts ggeditor *after* opening Premiere.
 */

const { handle } = require("./commands/index.js");

const PRODUCT = "gg-editor-premiere-panel";
const VERSION = "0.2.0";

const DEFAULT_PORT = 7437;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 5000;

// ── Persisted prefs (UXP supports localStorage) ─────────────

function getPort() {
  try {
    const stored = localStorage.getItem("gg.port");
    const n = stored ? parseInt(stored, 10) : NaN;
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  } catch (_) {}
  return DEFAULT_PORT;
}

function setPort(n) {
  try {
    localStorage.setItem("gg.port", String(n));
  } catch (_) {}
}

function getAutoConnect() {
  try {
    return localStorage.getItem("gg.autoConnect") === "1";
  } catch (_) {
    return false;
  }
}

function setAutoConnect(b) {
  try {
    localStorage.setItem("gg.autoConnect", b ? "1" : "0");
  } catch (_) {}
}

// ── UI plumbing ─────────────────────────────────────────────

let reqCount = 0;

function $(id) {
  return document.getElementById(id);
}
function setStatus(kind, label) {
  const el = $("status");
  if (!el) return;
  el.textContent = label;
  el.className = "pill " + (kind || "");
}
function setEndpoint(text) {
  const el = $("endpoint");
  if (el) el.textContent = text;
}
function bumpReqs() {
  reqCount += 1;
  const el = $("reqs");
  if (el) el.textContent = String(reqCount);
}
function setLastErr(msg) {
  const el = $("lastErr");
  if (!el) return;
  el.textContent = msg || "—";
  el.className = msg ? "err" : "muted";
}
function setConnectButtonLabel(label) {
  const el = $("connectBtn");
  if (el) el.textContent = label;
}

// ── WS client ───────────────────────────────────────────────

let socket = null;
let reconnectDelay = RECONNECT_INITIAL_MS;
let reconnectTimer = null;
let manuallyDisconnected = false;
let currentPort = DEFAULT_PORT;

function disconnect() {
  manuallyDisconnected = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close(1000, "user disconnected");
    } catch (_) {}
    socket = null;
  }
  setStatus("", "idle");
  setEndpoint("—");
  setConnectButtonLabel("Connect");
}

function connect() {
  manuallyDisconnected = false;
  if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
    return; // already connecting / connected
  }

  currentPort = getPort();
  const url = "ws://127.0.0.1:" + currentPort;
  setStatus("", "connecting…");
  setEndpoint(url);
  setConnectButtonLabel("Disconnect");

  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus("err", "open failed");
    setLastErr(String(e && e.message ? e.message : e));
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener("open", () => {
    reconnectDelay = RECONNECT_INITIAL_MS;
    setStatus("ok", "connected");
    setLastErr("");
    try {
      ws.send(
        JSON.stringify({
          kind: "hello",
          product: PRODUCT,
          panelKind: "uxp",
          version: VERSION,
        }),
      );
    } catch (e) {
      setLastErr("hello send failed: " + e);
    }
  });

  ws.addEventListener("message", async (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
    } catch (_) {
      return;
    }
    if (!msg || typeof msg.id !== "string" || typeof msg.method !== "string") return;

    bumpReqs();
    let response;
    try {
      const result = await handle(msg.method, msg.params || {});
      response = { id: msg.id, ok: true, result: result === undefined ? null : result };
    } catch (e) {
      const errMsg = e && e.message ? String(e.message) : String(e);
      setLastErr(errMsg);
      response = { id: msg.id, ok: false, error: errMsg };
    }
    try {
      if (ws.readyState === 1) ws.send(JSON.stringify(response));
    } catch (e) {
      setLastErr("send reply failed: " + e);
    }
  });

  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    if (manuallyDisconnected) return;
    setStatus("err", "disconnected");
    scheduleReconnect();
  });

  ws.addEventListener("error", (ev) => {
    setLastErr("ws error");
  });
}

function scheduleReconnect() {
  if (manuallyDisconnected) return;
  if (reconnectTimer) return;
  setConnectButtonLabel("Cancel");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (manuallyDisconnected) return;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    connect();
  }, reconnectDelay);
}

// ── Wire up UI on panel show ────────────────────────────────

function init(rootNode) {
  const portEl = $("port");
  const autoEl = $("autoConnect");
  const btnEl = $("connectBtn");

  if (portEl) {
    portEl.value = String(getPort());
    portEl.addEventListener("change", () => {
      const n = parseInt(portEl.value, 10);
      if (Number.isFinite(n) && n > 0 && n < 65536) setPort(n);
    });
  }

  if (autoEl) {
    if (getAutoConnect()) autoEl.setAttribute("checked", "");
    autoEl.addEventListener("change", () => {
      setAutoConnect(autoEl.checked || autoEl.hasAttribute("checked"));
    });
  }

  if (btnEl) {
    btnEl.addEventListener("click", () => {
      if (socket && socket.readyState === 1) {
        disconnect();
      } else {
        connect();
      }
    });
  }

  if (getAutoConnect()) {
    connect();
  }
}

// ── UXP entrypoint registration ─────────────────────────────

const { entrypoints } = require("uxp");

entrypoints.setup({
  panels: {
    "ggeditor.panel": {
      show(node) {
        init(node);
      },
    },
  },
});
