const { ethers } = window;

let provider, signer, contract, connectedAddress;

const el = (id) => document.getElementById(id);
const connectBtn = el("connectBtn");
const walletPill = el("walletPill");
const pendingList = el("pendingList");
const historyBody = el("historyBody");
const toastStack = el("toastStack");

const HARDHAT_CHAIN_HEX = "0x" + GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID.toString(16);

function toast(message, type = "info") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  toastStack.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
function decodeBytes32Safe(value) {
  try { return ethers.decodeBytes32String(value); } catch { return value; }
}

// ---------------------------------------------------------------
// Wallet connection (same automation pattern as the other two apps)
// ---------------------------------------------------------------
async function ensureCorrectNetwork() {
  const network = await provider.getNetwork();
  if (Number(network.chainId) === GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID) return true;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HARDHAT_CHAIN_HEX }] });
    return true;
  } catch (err) {
    if (err.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: HARDHAT_CHAIN_HEX, chainName: "Hardhat Local", rpcUrls: [GOVCHAIN_CONFIG.READ_ONLY_RPC_URL || "http://127.0.0.1:8545"], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }]
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function connectWallet(silent = false) {
  if (!window.ethereum) { if (!silent) toast("MetaMask not detected.", "err"); return; }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = silent ? await provider.send("eth_accounts", []) : await provider.send("eth_requestAccounts", []);
    if (!accounts.length) return;

    const ok = await ensureCorrectNetwork();
    if (!ok) { toast("Switch MetaMask to Hardhat Local.", "err"); return; }

    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    connectedAddress = await signer.getAddress();
    contract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, signer);

    connectBtn.textContent = "Connected";
    connectBtn.disabled = true;

    const isReviewer = await contract.isReviewPanelMember(connectedAddress);
    walletPill.innerHTML = `<span class="dot ${isReviewer ? "on" : "warn"}"></span>${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}${isReviewer ? "" : " (not a review panel member)"}`;

    if (!isReviewer) {
      pendingList.innerHTML = `<div class="flag-card"><span style="color:var(--alert); font-size:13px;">This wallet is not an authorized review panel member. Connect the reviewer account to take action on flags.</span></div>`;
    }

    attachLiveListeners();
    await refreshAll();
  } catch (err) {
    console.error(err);
    if (!silent) toast(`Connection failed: ${err.message || err}`, "err");
  }
}
connectBtn.addEventListener("click", () => connectWallet(false));
window.addEventListener("load", () => connectWallet(true));
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

// ---------------------------------------------------------------
// FR5 — Resolve a flag (Resolved / Disputed / Confirmed)
// FR6 fires automatically inside the contract when status = Confirmed
// ---------------------------------------------------------------
async function resolveFlag(flagId, status, btn) {
  try {
    btn.disabled = true;
    btn.textContent = "Confirm in MetaMask...";
    const tx = await contract.resolveFlag(flagId, status);
    btn.textContent = "Waiting for confirmation...";
    await tx.wait();
    toast(`Flag marked ${FLAG_STATUSES[status]}${status === 3 ? " — reputation token awarded automatically" : ""}`, status === 3 ? "ok" : "info");
  } catch (err) {
    console.error(err);
    const reason = err.reason || err.shortMessage || err.message || String(err);
    toast(`Action failed: ${reason}`, "err");
    btn.disabled = false;
    btn.textContent = btn.dataset.originalLabel;
  }
}

// ---------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------
function attachLiveListeners() {
  contract.removeAllListeners();
  contract.on("DiscrepancyFlagged", () => { toast("New discrepancy flagged", "info"); refreshAll(); });
  contract.on("FlagStatusChanged", () => refreshAll());
}

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------
async function refreshAll() {
  if (!contract) return;

  try {
    const flagCount = await contract.getFlagIdsCount();
    const pendingCards = [];
    const historyRows = [];
    let historyN = 0;

    for (let i = 0; i < flagCount; i++) {
      const flagId = await contract.getFlagIdAt(i);
      const flag = await contract.flags(flagId);
      const record = await contract.getRecord(flag.recordId).catch(() => null);
      const institutionName = record ? await contract.institutionNames(record.institutionId) : "Unknown";

      if (flag.status === 0n || flag.status === 0) {
        // Investigating — needs action
        pendingCards.push(`
          <div class="flag-card">
            <div class="flag-card-head">
              <div>
                <div class="flag-card-id">FLAG ${decodeBytes32Safe(flag.id)}</div>
                <div class="flag-card-record">${decodeBytes32Safe(flag.recordId)}</div>
                <div class="flag-card-meta">
                  ${institutionName} · ${record ? RECORD_TYPES[record.recordType] : "—"} ·
                  Flagged by ${flag.flaggedBy.slice(0, 8)}… on ${new Date(Number(flag.createdAt) * 1000).toLocaleString()}
                </div>
              </div>
            </div>
            <div class="flag-card-evidence">${flag.evidence}</div>
            ${record ? `
              <div class="hash-compare">
                <div class="hash-compare-item">Anchored hash<span class="mono">${record.hash}</span></div>
                <div class="hash-compare-item">Anchored by<span class="mono">${record.anchoredBy}</span></div>
              </div>` : ""}
            <div class="flag-card-actions">
              <button class="confirm" data-original-label="Confirm — Valid Discrepancy" data-flag="${flagId}" data-status="3">Confirm — Valid Discrepancy</button>
              <button class="dispute" data-original-label="Dispute — Not Valid" data-flag="${flagId}" data-status="2">Dispute — Not Valid</button>
              <button class="ghost resolve" data-original-label="Mark Resolved" data-flag="${flagId}" data-status="1">Mark Resolved</button>
            </div>
          </div>
        `);
      } else {
        historyN++;
        historyRows.push(`
          <tr>
            <td class="mono">${String(historyN).padStart(3, "0")}</td>
            <td class="mono">${decodeBytes32Safe(flag.id)}</td>
            <td class="mono">${decodeBytes32Safe(flag.recordId)}</td>
            <td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
            <td class="mono">${flag.flaggedBy.slice(0, 8)}…</td>
          </tr>
        `);
      }
    }

    pendingList.innerHTML = pendingCards.length
      ? pendingCards.join("")
      : `<div class="flag-card"><span style="color:var(--text-faint); font-size:13px;">No flags awaiting review. All caught up.</span></div>`;

    historyBody.innerHTML = historyRows.length ? historyRows.join("") : `<tr class="empty-row"><td colspan="5">No reviewed flags yet.</td></tr>`;

    // Wire up action buttons
    pendingList.querySelectorAll("[data-flag]").forEach((btn) => {
      btn.addEventListener("click", () => resolveFlag(btn.dataset.flag, Number(btn.dataset.status), btn));
    });
  } catch (err) {
    console.error(err);
    pendingList.innerHTML = `<div class="flag-card"><span style="color:var(--alert); font-size:13px;">Could not load flags: ${err.message}</span></div>`;
  }
}

if (GOVCHAIN_CONFIG.CONTRACT_ADDRESS.startsWith("PASTE_")) {
  pendingList.innerHTML = `<div class="flag-card"><span style="color:var(--alert); font-size:13px;">Config not set — edit frontend/shared/config.js first.</span></div>`;
}