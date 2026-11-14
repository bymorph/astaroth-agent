# Astaroth — a preview-first on-chain agent

**Wildcard submission, zkVerify Agent Games Season 01**
Operator: mephistophelsss (Greyyy, Indonesia) · Prize wallet: `0x51019FeCA7cb058FA4abE90d71d3289D4835624B`
Repo: github.com/bymorph/astaroth-agent (public) · Demo: see README for the live endpoint

## The use case

AI agents are starting to move real money on-chain: claiming rewards, selling tokens, minting, copying other wallets. The danger is not that an agent makes a bad trade. The danger is that a single bad transaction is irreversible — a wrong address, a hidden approval, an amount rounded up past the balance — and the wallet is drained before anyone notices. Most agent demos never face this because they run on testnets or ask the user to trust the model.

Astaroth is an agent that treats every transaction as guilty until proven safe. Before anything is executed, the action is previewed, simulated against live chain state, and checked against a fixed set of deterministic safety rules. Only a clean pass reaches execution, and the on-chain transaction hash is the receipt. The point is not cleverness. The point is that a wallet survived months of daily agent operation with no loss, no bad approval, and no drained balance — because the rules are boring and they are enforced every single time.

## The implementation

The service is one Node 22 process, standard library only, no dependencies. It watches a wallet on BNB Smart Chain through public RPC, read-only. It exposes four read endpoints and one evaluation endpoint: `/` (status page), `/health`, `/status` (live balance, reserve floor, block height, decision counts), `/actions` (recent evaluations plus the full historical evidence), and `POST /evaluate`, which takes a proposed action, simulates it with `eth_call` against live state, runs the decision engine, and returns the verdict with the per-rule results.

The decision engine is a pure function: same action plus same chain state gives the same verdict, every time. There is no language model in the decision path and no randomness. It enforces seven rules in a fixed order: the action must be well-formed; live chain state must be available; the simulation must be clean; the calldata must not contain an approval or allowance change; value must be zero unless the operator explicitly ordered a spend; at least 0.006 BNB must remain after gas; amounts must be strictly below the on-chain balance (truncate, never round up); swaps must be a single atomic transaction, never transfer-then-swap. Any failure, missing field, or RPC error is a REJECT. The engine fails closed by design.

The demo runs in dry-run mode: it evaluates and logs, and it never signs or sends anything. The repository contains no private key and no signing code at all. A `--live` flag exists but refuses to start without an explicit confirmation variable, and even then the build has no execution path — that is intentional. The demo proves the decision logic; the evidence file proves the operation.

## Verifiability

This entry is built around the same question zkVerify asks: how do you know the agent did what it claims? Astaroth's answer is receipts, not assertions. Every entry in `evidence.json` carries a date, a decision, a reason, and either a transaction hash anyone can check on a block explorer, or the words "blocked — no tx sent".

Two kinds of evidence matter. The first is the prior work that taught the rules: the AGCC reward loop — claiming vested rewards across three operator wallets, consolidating them, and selling in one atomic swap — with every transaction hash listed (sale #6: 1,397,440 AGC sold for 0.00768799 BNB on 2026-11-14), plus the Alchemister free mints. Those were the operator's own operations, not executions by the code in this repo — they are the history the rulebook was written from. The second is the work this repo's engine does itself, live and reproducible: a `POST /evaluate` with an `approve()` call is rejected on `AUTHORITY_CHANGE` even though the simulation is clean, and every live evaluation against the watched wallet rejects on `RESERVE_FLOOR` because the balance sits below the floor. A safety record that only shows successes is marketing; the blocks are the proof the rules actually bind.

That is also where this connects to verifiable agents. The decision engine is deterministic, so its verdicts are reproducible from the same inputs; the simulation is a public RPC call anyone can replay; and the outcome is an on-chain hash anyone can verify. The missing piece — the one this competition points at — is a zero-knowledge proof that the decision followed the rules without revealing the operator's private parameters. Astaroth is built so that proof can be attached later: the rules are fixed, the inputs are public, and the verdict is already a pure function of them. The agent does not ask for trust; it leaves a trail a third party can check.

## Build context

This was not built for the competition. It is the operating discipline distilled from the operator's own months of on-chain activity on BNB Smart Chain since October 2026: dozens of free mints, repeated claim-and-sell loops, a copy-watch on another operator's wallet, and a standing rulebook written down after the first mistakes — never transfer-then-swap, always truncate amounts, never bypass a safety block. The code in this repo is the standalone version of that rulebook — it uses no wallet-agent framework and holds no wallet session — and the evidence file is the prior history it was written from, plus the live demonstrations that prove the engine enforces the rules. The entry's demo watches the operator's wallet read-only.
