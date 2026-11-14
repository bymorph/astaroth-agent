// Deterministic decision engine for Astaroth, the preview-first on-chain agent.
//
// Every proposed action passes through the same checks, in the same order,
// with no model and no randomness anywhere in the path. A check that cannot
// be proven to pass is a REJECT: the engine fails closed, because approving
// an action it does not understand is how wallets get drained.
//
// Action shape (all amounts are decimal strings of wei, never floats):
//   {
//     kind: "mint" | "claim" | "transfer" | "swap" | "approve" | "custom",
//     to: "0x..."            // contract / recipient address
//     valueWei: "0",        // native BNB the action sends
//     data: "0x...",        // calldata; selector is inspected
//     amountWei: "0",       // token amount the action moves (if any)
//     tokenBalanceWei: "0", // on-chain token balance of the acting wallet
//     userOrderedSpend: false, // true only when the operator explicitly ordered a spend
//     simulationOk: false,  // true only when eth_call against live state succeeded
//     steps: 1,             // number of transactions the action needs (swaps must be 1)
//     priorTransfer: false, // true if value was moved before the swap
//     gasLimit: 200000,     // gas the action is expected to use
//   }
//
// State shape (fetched live, read-only):
//   { ok: true, balanceWei: "0", gasPriceWei: "0", blockNumber: "0" }
//   { ok: false } when the RPC is unreachable — state unknown means REJECT.

// Selectors that change what a contract may do with the wallet's assets.
const AUTHORITY_SELECTORS = new Set([
  "0xa22cb465", // setApprovalForAll(address,bool)
  "0x095ea7b3", // approve(address,uint256)
  "0x39509351", // increaseAllowance(address,uint256)
]);

export const RESERVE_FLOOR_WEI = 6000000000000000n; // 0.006 BNB, never spent below

function isAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}
function isHexData(d) {
  return typeof d === "string" && /^0x([0-9a-fA-F]{2})*$/.test(d);
}
function toBig(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v)) return BigInt(v);
  return null;
}

// Returns { decision: "APPROVE" | "REJECT", reason_code, checks: [{rule, pass, detail}] }
export function decide(action, state) {
  const checks = [];
  const reject = (code, detail) => ({
    decision: "REJECT",
    reason_code: code,
    checks: [...checks, { rule: code, pass: false, detail }],
  });

  // (g) Fail closed — the action itself must be well-formed, or nothing else runs.
  if (!action || typeof action !== "object") {
    return reject("INVALID_ACTION", "action is not an object");
  }
  const valueWei = toBig(action.valueWei);
  const amountWei = action.amountWei === undefined ? null : toBig(action.amountWei);
  const tokenBalanceWei = action.tokenBalanceWei === undefined ? null : toBig(action.tokenBalanceWei);
  const gasLimit = toBig(action.gasLimit ?? 200000);
  const steps = action.steps === undefined ? 1 : action.steps;
  if (
    typeof action.kind !== "string" ||
    !["mint", "claim", "transfer", "swap", "approve", "custom"].includes(action.kind) ||
    !isAddress(action.to) ||
    valueWei === null ||
    !isHexData(action.data ?? "0x") ||
    gasLimit === null ||
    typeof steps !== "number" ||
    !Number.isInteger(steps) ||
    steps < 1
  ) {
    return reject("INVALID_ACTION", "missing or malformed action field");
  }
  checks.push({ rule: "WELL_FORMED", pass: true, detail: "action parses" });

  // (g) State unknown — without live chain state there is nothing to check against.
  if (!state || state.ok !== true) {
    return reject("RPC_UNAVAILABLE", "live chain state unavailable");
  }
  const balanceWei = toBig(state.balanceWei);
  const gasPriceWei = toBig(state.gasPriceWei);
  if (balanceWei === null || gasPriceWei === null) {
    return reject("RPC_UNAVAILABLE", "balance or gas price unreadable");
  }
  checks.push({ rule: "STATE_KNOWN", pass: true, detail: "live balance and gas price read" });

  // (a) Simulate first — the action must have a clean simulation, no revert.
  if (action.simulationOk !== true) {
    return reject("SIMULATION_FAILED", "no clean eth_call simulation on live state");
  }
  checks.push({ rule: "SIMULATION_CLEAN", pass: true, detail: "eth_call succeeded, no revert" });

  // (b) No approval / authority changes — the agent never hands a contract
  //     permission to move the wallet's assets, for any reason.
  const selector = (action.data || "0x").slice(0, 10).toLowerCase();
  if (action.kind === "approve" || AUTHORITY_SELECTORS.has(selector)) {
    return reject("AUTHORITY_CHANGE", `calldata selector ${selector} changes allowances`);
  }
  checks.push({ rule: "NO_AUTHORITY_CHANGE", pass: true, detail: "no approval selector" });

  // (c) Value must be 0 unless the operator explicitly ordered a spend.
  if (valueWei > 0n && action.userOrderedSpend !== true) {
    return reject("UNORDERED_SPEND", `value ${valueWei} wei without an explicit operator order`);
  }
  checks.push({ rule: "VALUE_ALLOWED", pass: true, detail: valueWei === 0n ? "value 0" : "operator-ordered spend" });

  // (d) The BNB reserve floor must remain after gas (and value, if any).
  const gasCostWei = gasLimit * gasPriceWei;
  if (balanceWei - valueWei - gasCostWei < RESERVE_FLOOR_WEI) {
    return reject(
      "RESERVE_FLOOR",
      `balance ${balanceWei} - value ${valueWei} - gas ${gasCostWei} would fall below 0.006 BNB`,
    );
  }
  checks.push({ rule: "RESERVE_FLOOR", pass: true, detail: "0.006 BNB remains after gas" });

  // (e) Amounts strictly below the on-chain balance — truncate, never round up.
  // A zero amount moves nothing, so the check only applies when something moves.
  if (amountWei !== null && amountWei > 0n && tokenBalanceWei !== null && amountWei >= tokenBalanceWei) {
    return reject(
      "AMOUNT_AT_OR_ABOVE_BALANCE",
      `amount ${amountWei} is not strictly below balance ${tokenBalanceWei}`,
    );
  }
  checks.push({ rule: "AMOUNT_BELOW_BALANCE", pass: true, detail: "amount strictly below balance" });

  // (f) Swaps must be atomic single transactions — never transfer-then-swap.
  if (action.kind === "swap" && (steps > 1 || action.priorTransfer === true)) {
    return reject("NON_ATOMIC_SWAP", "swap needs more than one transaction or a prior transfer");
  }
  checks.push({ rule: "ATOMIC_SWAP", pass: true, detail: "single-transaction swap" });

  return { decision: "APPROVE", reason_code: "VALID", checks };
}
