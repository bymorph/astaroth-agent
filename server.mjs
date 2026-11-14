// Astaroth — a preview-first on-chain agent (Wildcard demo service).
// Node 22, stdlib only. Read-only by design: this repo contains no private
// key, no signing code, and no transaction-sending code anywhere. The service
// watches one wallet on BSC, simulates proposed actions against live chain
// state, and logs a deterministic APPROVE / REJECT for each one.
//
//   node server.mjs            # dry-run demo (default), PORT=3000
//   PORT=3001 node server.mjs  # any port
//   node server.mjs --live     # REFUSES unless ASTAROTH_LIVE_CONFIRM=I_UNDERSTAND
//                              # is set — and even then, live mode only
//                              # evaluates and logs: execution is not
//                              # implemented in this build, on purpose.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, RESERVE_FLOOR_WEI } from "./decide.mjs";
import { getBalanceWei, getGasPriceWei, getBlockNumber, simulateCall } from "./rpc.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const WATCH_ADDRESS = (process.env.WATCH_ADDRESS || "0x51019FeCA7cb058FA4abE90d71d3289D4835624B").toLowerCase();
const MODE = process.env.MODE || "dry-run";
const POLL_MS = Number(process.env.POLL_MS || 60000);
const STARTED_AT = Date.now();

if (process.argv.includes("--live") && process.env.ASTAROTH_LIVE_CONFIRM !== "I_UNDERSTAND") {
  console.error(
    "Refusing --live: set ASTAROTH_LIVE_CONFIRM=I_UNDERSTAND to confirm you understand " +
    "this build still cannot execute anything (no signing code exists in this repo).",
  );
  process.exit(1);
}
if (process.argv.includes("--live")) {
  console.error("Live flag accepted, but this build has no execution path: evaluation and logging only.");
}

const evidence = JSON.parse(fs.readFileSync(path.join(DIR, "evidence.json"), "utf8"));

const state = {
  ok: false,
  balanceWei: null,
  gasPriceWei: null,
  blockNumber: null,
  asOf: null,
  endpoint: null,
};
const decisions = []; // live evaluations, newest first, capped at 100

function weiToBnb(w) {
  if (w === null || w === undefined) return null;
  try {
    const s = BigInt(w).toString().padStart(19, "0");
    return `${s.slice(0, -18)}.${s.slice(-18).replace(/0+$/, "") || "0"}`;
  } catch { return null; }
}

async function refreshState() {
  const [bal, gas, block] = await Promise.all([getBalanceWei(WATCH_ADDRESS), getGasPriceWei(), getBlockNumber()]);
  if (bal.ok && gas.ok && block.ok) {
    state.ok = true;
    state.balanceWei = BigInt(bal.result).toString();
    state.gasPriceWei = BigInt(gas.result).toString();
    state.blockNumber = BigInt(block.result).toString();
    state.endpoint = bal.endpoint;
  } else {
    // Keep the last known values but mark the state untrusted: the decision
    // engine fails closed on state.ok === false.
    state.ok = false;
  }
  state.asOf = new Date().toISOString();
}

function logDecision(action, result) {
  decisions.unshift({
    at: new Date().toISOString(),
    action: {
      kind: action.kind,
      to: action.to,
      valueWei: String(action.valueWei ?? "0"),
      amountWei: action.amountWei === undefined ? null : String(action.amountWei),
      userOrderedSpend: action.userOrderedSpend === true,
    },
    decision: result.decision,
    reason_code: result.reason_code,
    checks: result.checks,
  });
  if (decisions.length > 100) decisions.length = 100;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function statusPage() {
  const bal = weiToBnb(state.balanceWei);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Astaroth — preview-first on-chain agent</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111}code{background:#f0f0f0;padding:1px 5px;border-radius:4px}.tag{display:inline-block;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:2px 8px;font-size:13px}</style></head>
<body><h1>Astaroth</h1>
<p><span class="tag">dry-run demo — read-only, no keys, no signing</span></p>
<p>A preview-first on-chain agent. Every proposed action is simulated against live BSC state and checked against deterministic safety rules before it is ever executed. The on-chain transaction hash is the receipt.</p>
<ul>
<li>Watched wallet: <code>${WATCH_ADDRESS}</code></li>
<li>Chain: BSC (56) · balance: <code>${bal === null ? "unknown" : bal + " BNB"}</code> · reserve floor: <code>0.006 BNB</code></li>
<li>State: <code>${state.ok ? "live" : "stale / unreachable"}</code> as of ${state.asOf || "—"}</li>
<li>Live evaluations this run: <code>${decisions.length}</code> · evidence entries: <code>${evidence.entries.length}</code></li>
</ul>
<p>Endpoints: <a href="/health">/health</a> · <a href="/status">/status</a> · <a href="/actions">/actions</a> · <code>POST /evaluate</code></p>
<p>Read the evidence: <a href="/actions">/actions</a> (every historical decision with its transaction hash, or "blocked — no tx sent").</p>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(statusPage());
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return sendJson(res, 200, {
        agent: "Astaroth",
        mode: MODE,
        chain: "BSC",
        chainId: 56,
        watchedAddress: WATCH_ADDRESS,
        balanceWei: state.balanceWei,
        balanceBnb: weiToBnb(state.balanceWei),
        reserveFloorBnb: "0.006",
        reserveFloorWei: RESERVE_FLOOR_WEI.toString(),
        gasPriceWei: state.gasPriceWei,
        blockNumber: state.blockNumber,
        stateOk: state.ok,
        stateAsOf: state.asOf,
        rpcEndpoint: state.endpoint,
        decisionsLogged: decisions.length,
        evidenceEntries: evidence.entries.length,
        uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
      });
    }
    if (req.method === "GET" && url.pathname === "/actions") {
      return sendJson(res, 200, { decisions, evidence: evidence.entries });
    }
    if (req.method === "POST" && url.pathname === "/evaluate") {
      const chunks = [];
      req.on("data", (c) => {
        chunks.push(c);
        if (Buffer.concat(chunks).length > 65536) req.destroy();
      });
      req.on("end", async () => {
        let action;
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          action = parsed && typeof parsed === "object" ? parsed.action || parsed : null;
        } catch { action = null; }
        if (!action) {
          return sendJson(res, 400, { decision: "REJECT", reason_code: "INVALID_ACTION", checks: [] });
        }
        // Refresh state if it is older than 30 seconds, so the decision uses
        // fresh chain data. A failed refresh leaves state.ok === false and
        // the engine fails closed.
        if (!state.asOf || Date.now() - Date.parse(state.asOf) > 30000) await refreshState();
        // The server simulates the action itself via eth_call; a caller's
        // claim about simulation is never trusted.
        let simulationOk = false;
        if (typeof action.to === "string" && /^0x[0-9a-fA-F]{40}$/.test(action.to)) {
          try {
            const sim = await simulateCall({
              from: WATCH_ADDRESS,
              to: action.to,
              valueWei: String(action.valueWei ?? "0"),
              data: action.data ?? "0x",
            });
            simulationOk = sim.ok;
          } catch { simulationOk = false; }
        }
        const result = decide({ ...action, simulationOk }, state);
        logDecision(action, result);
        return sendJson(res, 200, result);
      });
      return;
    }
    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch {
    return sendJson(res, 200, { decision: "REJECT", reason_code: "UNCERTAIN", checks: [] });
  }
});

refreshState().then(() => {
  setInterval(() => { refreshState().catch(() => {}); }, POLL_MS);
  server.listen(PORT, () => {
    console.log(`Astaroth listening on :${PORT} (mode=${MODE}, watch=${WATCH_ADDRESS})`);
  });
});
