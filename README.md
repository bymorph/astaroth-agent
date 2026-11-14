# Astaroth — a preview-first on-chain agent

**Wildcard entry for the zkVerify Agent Games, Season 01.**
Operator: **mephistophelsss** (Greyyy, Indonesia) · prize wallet: `0x51019FeCA7cb058FA4abE90d71d3289D4835624B`

## The problem

AI agents that move real money on-chain are dangerous. One bad transaction —
a wrong address, a hidden approval, an amount rounded up past the balance —
drains a wallet, and the chain does not undo it. Most agent demos never face
this: they run on testnets, or they ask the user to trust the model.

Astaroth's answer is boring on purpose: **verify before executing.** Every
proposed action is simulated against live chain state, checked against a
fixed set of deterministic safety rules, and only then executed. The
on-chain transaction hash is the receipt that proves what happened. No
claim without a receipt.

## The safety model

```
propose → preview → simulate (eth_call) → decide → execute → verify (tx hash)
```

The decision engine (`decide.mjs`) is pure and deterministic — no model, no
randomness, no network call inside the decision path. An action is APPROVED
only when every rule passes; anything it cannot prove is a REJECT:

| Rule | What it stops |
| --- | --- |
| Simulate first | Reverting calls, wrong calldata, dead contracts |
| No authority changes | `approve`, `increaseAllowance`, `setApprovalForAll` — always rejected |
| Value is 0 unless ordered | The agent never spends unless the operator explicitly ordered that spend |
| 0.006 BNB reserve floor | The wallet keeps a gas reserve after every action |
| Amounts strictly below balance | Truncate, never round up — an amount equal to the balance is rejected |
| Atomic swaps only | Never transfer-then-swap; one transaction or nothing |
| Fail closed | Missing field, RPC error, or any uncertainty → REJECT |

This is not a weekend toy. The rules are the operating rules of a live agent
that has run on BNB Smart Chain since October 2026 — executed through the
Binance Agentic Wallet (`baw`) using three Binance Agent ID wallets
(`astaroth.ai`, `4leafclover.ai`, `gemini30.ai`). That wallet's
preview/simulation and risk engine are the execution layer the rules sit on:
the blocks below were enforced by that engine (error `351803`). The demo in
this repo is standalone — it does not connect to Binance, holds no wallet
session, and cannot sign anything; it re-implements the same rules against
public RPC, read-only.

## Run it

Node 22, no dependencies to install (stdlib only).

```bash
node server.mjs                 # dry-run demo, PORT=3000
PORT=3001 node server.mjs       # any port
WATCH_ADDRESS=0x... node server.mjs   # watch a different wallet (read-only)
```

`--live` refuses to start unless `ASTAROTH_LIVE_CONFIRM=I_UNDERSTAND` is set —
and even then, this build has no execution path: there is no signing code in
this repo, so live mode only evaluates and logs. That is deliberate.

## Endpoints

| Endpoint | What it returns |
| --- | --- |
| `GET /` | Status page (HTML) |
| `GET /health` | `{ok:true}` |
| `GET /status` | Agent state: watched wallet, live BNB balance, reserve floor, block, decisions count |
| `GET /actions` | Recent live evaluations plus the full historical evidence with receipts |
| `POST /evaluate` | Submit a proposed action as JSON; the server simulates it against live BSC state (eth_call) and returns `{decision, reason_code, checks}` |

Example:

```bash
curl -X POST localhost:3000/evaluate -H 'content-type: application/json' -d '{
  "kind": "mint",
  "to": "0xcafeeddf3c15c5cd9a63d97021efde845e1781bc",
  "valueWei": "0",
  "data": "0x",
  "amountWei": "0",
  "tokenBalanceWei": "0",
  "userOrderedSpend": false
}'
```

## Evidence

[`evidence.json`](evidence.json) — the real operating history: the AGCC
claim/consolidate/sell loop (sales #5 and #6, with transaction hashes), the
Alchemister free mints, the blocked burn and listing, and the copy-watch
rules. Every entry carries a date, a decision, a reason, and a transaction
hash — or the words "blocked — no tx sent". Only public on-chain data is in
this repo: wallet addresses and transaction hashes. No keys, tokens, or
credentials anywhere.
