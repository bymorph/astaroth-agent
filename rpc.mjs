// Read-only BSC JSON-RPC client. No keys, no signing, no sending —
// only eth_getBalance / eth_call / eth_gasPrice / eth_blockNumber.
// Tries each public endpoint in order; fetch first, curl subprocess as a
// fallback (curl survives the egress proxies in this sandbox where some
// HTTP stacks stall). Every call is bounded by a timeout and fails closed:
// callers get null and must treat the state as unknown.
import { execFile } from "node:child_process";

export const RPC_ENDPOINTS = [
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://bsc.publicnode.com/",
];

const TIMEOUT_MS = 8000;

function fetchRpc(url, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  })
    .then((r) => (r.ok ? r.json() : null))
    .finally(() => clearTimeout(timer));
}

function curlRpc(url, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    execFile(
      "curl",
      ["-sS", "--max-time", String(TIMEOUT_MS / 1000), "-X", "POST", url,
       "-H", "content-type: application/json", "-d", JSON.stringify(payload)],
      { timeout: TIMEOUT_MS },
      (err, stdout) => {
        clearTimeout(timer);
        if (err) return resolve(null);
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      },
    );
  });
}

export async function rpcCall(method, params) {
  const payload = { jsonrpc: "2.0", id: 1, method, params };
  for (const url of RPC_ENDPOINTS) {
    let res = null;
    try { res = await fetchRpc(url, payload); } catch { res = null; }
    if (!res || res.error || res.result === undefined || res.result === null) {
      try { res = await curlRpc(url, payload); } catch { res = null; }
    }
    if (res && !res.error && res.result !== undefined && res.result !== null) {
      return { ok: true, result: res.result, endpoint: url };
    }
  }
  return { ok: false, result: null, endpoint: null };
}

export async function getBalanceWei(address) {
  return rpcCall("eth_getBalance", [address, "latest"]);
}

export async function getGasPriceWei() {
  return rpcCall("eth_gasPrice", []);
}

export async function getBlockNumber() {
  return rpcCall("eth_blockNumber", []);
}

// Simulate a call against live chain state. eth_call never creates a
// transaction; a revert (or any RPC error) means the simulation is NOT clean.
export async function simulateCall({ from, to, valueWei, data }) {
  const tx = { from, to, value: "0x" + BigInt(valueWei).toString(16) };
  if (data && data !== "0x") tx.data = data;
  const res = await rpcCall("eth_call", [tx, "latest"]);
  return { ok: res.ok, result: res.ok ? res.result : null };
}
