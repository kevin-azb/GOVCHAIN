const { ethers } = window;

let walletProvider, signer, writeContract, connectedAddress;
let readContract; // works with no wallet at all — satisfies FR3's "with or without a wallet"
let knownFlagIds = new Set();
let knownRecordIds = new Set();
let lastVerifiedRecordId = null;

const el = (id) => document.getElementById(id);
const connectBtn = el("connectBtn");
const walletPill = el("walletPill");
const reputationPill = el("reputationPill");
const reputationValue = el("reputationValue");

const recordIdInput = el("recordIdInput");
const docContentInput = el("docContentInput");
const dropzone = el("dropzone");
const fileInput = el("fileInput");
const verifyBtn = el("verifyBtn");
const verifyStatus = el("verifyStatus");
const verifyResult = el("verifyResult");
const verifyResultTitle = el("verifyResultTitle");
const verifyResultDetail = el("verifyResultDetail");
const flagPrompt = el("flagPrompt");

const flagSection = el("flagSection");
const evidenceInput = el("evidenceInput");
const submitFlagBtn = el("submitFlagBtn");
const flagStatus = el("flagStatus");

const myFlagsSection = el("myFlagsSection");
const myFlagsBody = el("myFlagsBody");
const recentBody = el("recentBody");

const statRecords = el("statRecords");
const statFlags = el("statFlags");
const statResolved = el("statResolved");
const statAvgTime = el("statAvgTime");

const toastStack = el("toastStack");

const HARDHAT_CHAIN_HEX = "0x" + GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID.toString(16);
let pendingHash = "";

// ---------------------------------------------------------------
// Toasts + status helpers
// ---------------------------------------------------------------
function toast(message, type = "info") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  toastStack.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
function showStatus(target, message, type) {
  target.textContent = message;
  target.className = `status-line show ${type}`;
}
function decodeBytes32Safe(value) {
  try { return ethers.decodeBytes32String(value); } catch { return value; }
}

// ---------------------------------------------------------------
// Read-only connection — works even with no MetaMask installed (FR3)
// ---------------------------------------------------------------
function initReadOnlyContract() {
  const rpc = new ethers.JsonRpcProvider(GOVCHAIN_CONFIG.READ_ONLY_RPC_URL);
  readContract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, rpc);
}

// ---------------------------------------------------------------
// Hashing (identical approach to the Institution Console — same
// document, same hash, or it won't match)
// ---------------------------------------------------------------
docContentInput.addEventListener("input", () => {
  const text = docContentInput.value;
  pendingHash = text ? ethers.keccak256(ethers.toUtf8Bytes(text)) : "";
});

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  pendingHash = ethers.keccak256(new Uint8Array(buffer));
  docContentInput.value = `[file: ${file.name}, ${(file.size / 1024).toFixed(1)} KB — hashed directly]`;
  toast(`Hashed "${file.name}"`, "ok");
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => { if (e.target.files[0]) hashFile(e.target.files[0]); });
["dragenter", "dragover"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) hashFile(f); });

// ---------------------------------------------------------------
// FR3 — Verify a record (no wallet required)
// ---------------------------------------------------------------
async function verifyRecord() {
  const rawId = recordIdInput.value.trim();
  if (!rawId) { showStatus(verifyStatus, "Enter a record ID.", "err"); return; }
  if (!pendingHash) { showStatus(verifyStatus, "Provide the document (drop a file or paste text) to check.", "err"); return; }

  let recordIdBytes32;
  try {
    recordIdBytes32 = ethers.encodeBytes32String(rawId);
  } catch {
    showStatus(verifyStatus, "Record ID must be 31 characters or fewer.", "err");
    return;
  }

  try {
    verifyBtn.disabled = true;
    showStatus(verifyStatus, "Checking against the chain...", "info");

    const [matches, record] = await readContract.verifyRecord(recordIdBytes32, pendingHash);
    const institutionName = await readContract.institutionNames(record.institutionId);

    verifyResult.classList.add("show");
    lastVerifiedRecordId = rawId;

    if (matches) {
      verifyResult.className = "verify-result show match";
      verifyResultTitle.textContent = "✓ Verified — records match";
      verifyResultDetail.innerHTML = `Anchored by <span class="mono">${institutionName}</span> on ${new Date(Number(record.timestamp) * 1000).toLocaleString()}. Hash matches exactly.`;
      flagPrompt.innerHTML = "";
    } else {
      verifyResult.className = "verify-result show mismatch";
      verifyResultTitle.textContent = "✕ Mismatch — the document doesn't match what was anchored";
      verifyResultDetail.innerHTML = `Institution's anchored hash: <span class="mono">${record.hash.slice(0, 18)}…</span><br/>Your document's hash: <span class="mono">${pendingHash.slice(0, 18)}…</span>`;
      flagPrompt.innerHTML = `<button id="openFlagBtn">Flag This Discrepancy</button>`;
      document.getElementById("openFlagBtn").addEventListener("click", () => {
        flagSection.style.display = "block";
        flagSection.scrollIntoView({ behavior: "smooth" });
      });
    }
    showStatus(verifyStatus, "Done.", "ok");
  } catch (err) {
    console.error(err);
    const reason = err.reason || err.shortMessage || err.message || String(err);
    if (reason.includes("record not found")) {
      showStatus(verifyStatus, `No record found with ID "${rawId}". Check the ID and try again.`, "err");
    } else {
      showStatus(verifyStatus, `Verification failed: ${reason}`, "err");
    }
    verifyResult.classList.remove("show");
  } finally {
    verifyBtn.disabled = false;
  }
}
verifyBtn.addEventListener("click", verifyRecord);

// ---------------------------------------------------------------
// Wallet connect (needed only for flagging + seeing your own reputation)
// ---------------------------------------------------------------
async function ensureCorrectNetwork() {
  const network = await walletProvider.getNetwork();
  if (Number(network.chainId) === GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID) return true;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: HARDHAT_CHAIN_HEX }] });
    return true;
  } catch (err) {
    if (err.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: HARDHAT_CHAIN_HEX, chainName: "Hardhat Local", rpcUrls: [GOVCHAIN_CONFIG.READ_ONLY_RPC_URL], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }]
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function connectWallet(silent = false) {
  if (!window.ethereum) {
    if (!silent) toast("No wallet detected — you can still verify records, but flagging requires a wallet.", "info");
    return;
  }
  try {
    walletProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = silent ? await walletProvider.send("eth_accounts", []) : await walletProvider.send("eth_requestAccounts", []);
    if (!accounts.length) return;

    const ok = await ensureCorrectNetwork();
    if (!ok) { toast("Switch MetaMask to Hardhat Local to flag discrepancies.", "err"); return; }

    walletProvider = new ethers.BrowserProvider(window.ethereum);
    signer = await walletProvider.getSigner();
    connectedAddress = await signer.getAddress();
    writeContract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, signer);

    connectBtn.textContent = "Connected";
    connectBtn.disabled = true;
    walletPill.innerHTML = `<span class="dot on"></span>${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`;

    const reputation = await readContract.reputationBalance(connectedAddress);
    reputationPill.style.display = "flex";
    reputationValue.textContent = reputation.toString();

    myFlagsSection.style.display = "block";
    attachLiveListeners();
    await refreshMyFlags();
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
// FR4 — Submit a discrepancy flag (requires wallet)
// ---------------------------------------------------------------
async function submitFlag() {
  if (!writeContract) { showStatus(flagStatus, "Connect your wallet first.", "err"); return; }
  const evidence = evidenceInput.value.trim();
  if (!evidence) { showStatus(flagStatus, "Describe the discrepancy first.", "err"); return; }
  if (!lastVerifiedRecordId) { showStatus(flagStatus, "Verify a record above before flagging it.", "err"); return; }

  const recordIdBytes32 = ethers.encodeBytes32String(lastVerifiedRecordId);
  const flagId = ethers.encodeBytes32String(`F-${Date.now().toString(36).slice(-10).toUpperCase()}`);

  try {
    submitFlagBtn.disabled = true;
    showStatus(flagStatus, "Submitting — confirm in MetaMask...", "info");
    const tx = await writeContract.flagDiscrepancy(flagId, recordIdBytes32, evidence);
    showStatus(flagStatus, "Waiting for confirmation...", "info");
    await tx.wait();
    showStatus(flagStatus, "Flag submitted. You'll be notified here when it's reviewed.", "ok");
    toast("Discrepancy flagged — thank you for reporting it.", "ok");
    evidenceInput.value = "";
  } catch (err) {
    console.error(err);
    const reason = err.reason || err.shortMessage || err.message || String(err);
    showStatus(flagStatus, `Failed to submit flag: ${reason}`, "err");
  } finally {
    submitFlagBtn.disabled = false;
  }
}
submitFlagBtn.addEventListener("click", submitFlag);

// ---------------------------------------------------------------
// FR10 — Live notifications + auto-refresh via on-chain events
// ---------------------------------------------------------------
function attachLiveListeners() {
  readContract.removeAllListeners();

  readContract.on("RecordAnchored", () => { refreshDashboardStats(); refreshRecent(); });

  readContract.on("DiscrepancyFlagged", (flagId, recordId, flaggedBy) => {
    refreshDashboardStats();
    if (connectedAddress && flaggedBy.toLowerCase() === connectedAddress.toLowerCase()) refreshMyFlags();
  });

  readContract.on("FlagStatusChanged", async (flagId, status) => {
    refreshDashboardStats();
    if (!connectedAddress) return;
    const flag = await readContract.flags(flagId);
    if (flag.flaggedBy.toLowerCase() === connectedAddress.toLowerCase()) {
      toast(`Your flag on ${decodeBytes32Safe(flag.recordId)} is now: ${FLAG_STATUSES[status]}`, status == 3 ? "ok" : "info");
      refreshMyFlags();
      const reputation = await readContract.reputationBalance(connectedAddress);
      reputationValue.textContent = reputation.toString();
    }
  });

  readContract.on("ReputationTokenAwarded", async (citizen, amount) => {
    if (connectedAddress && citizen.toLowerCase() === connectedAddress.toLowerCase()) {
      toast(`You earned ${amount} reputation tokens for a confirmed report!`, "ok");
    }
  });
}

// ---------------------------------------------------------------
// FR8 — Public Transparency Dashboard (aggregate, non-identifying)
// ---------------------------------------------------------------
async function refreshDashboardStats() {
  try {
    const totalRecords = await readContract.totalRecords();
    statRecords.textContent = totalRecords.toString();

    const flagCount = await readContract.getFlagIdsCount();
    statFlags.textContent = flagCount.toString();

    let resolvedCount = 0;
    let totalResolutionSeconds = 0n;

    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      if (flag.status === 0) continue; // still Investigating

      resolvedCount++;
      // Pull the resolution timestamp from the event log itself (the contract
      // doesn't store it directly), then diff against when the flag was raised.
      const events = await readContract.queryFilter(readContract.filters.FlagStatusChanged(flagId));
      if (events.length) {
        const resolvedAt = events[events.length - 1].args.timestamp;
        totalResolutionSeconds += (resolvedAt - flag.createdAt);
      }
    }

    statResolved.textContent = resolvedCount.toString();
    if (resolvedCount > 0) {
      const avgSeconds = Number(totalResolutionSeconds / BigInt(resolvedCount));
      statAvgTime.textContent = avgSeconds < 60 ? `${avgSeconds}s` : avgSeconds < 3600 ? `${Math.round(avgSeconds / 60)}m` : `${(avgSeconds / 3600).toFixed(1)}h`;
    } else {
      statAvgTime.textContent = "—";
    }
  } catch (err) {
    console.error(err);
  }
}

async function refreshRecent() {
  try {
    const count = await readContract.getRecordIdsCount();
    const rows = [];
    const start = Math.max(0, Number(count) - 15); // last 15
    for (let i = Number(count) - 1; i >= start; i--) {
      const id = await readContract.getRecordIdAt(i);
      const record = await readContract.getRecord(id);
      const institutionName = await readContract.institutionNames(record.institutionId);
      const isNew = !knownRecordIds.has(id);
      knownRecordIds.add(id);
      rows.push(`
        <tr class="${isNew && knownRecordIds.size > 1 ? "new-row" : ""}">
          <td class="mono">${String(i + 1).padStart(3, "0")}</td>
          <td class="mono">${decodeBytes32Safe(id)}</td>
          <td>${RECORD_TYPES[record.recordType] ?? record.recordType}</td>
          <td>${institutionName}</td>
          <td>${new Date(Number(record.timestamp) * 1000).toLocaleString()}</td>
        </tr>
      `);
    }
    recentBody.innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="5">No records anchored yet.</td></tr>`;
  } catch (err) {
    console.error(err);
    recentBody.innerHTML = `<tr class="empty-row"><td colspan="5">Could not load recent activity: ${err.message}</td></tr>`;
  }
}

async function refreshMyFlags() {
  if (!connectedAddress) return;
  try {
    const flagCount = await readContract.getFlagIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      if (flag.flaggedBy.toLowerCase() !== connectedAddress.toLowerCase()) continue;
      n++;
      const isNew = !knownFlagIds.has(flagId);
      knownFlagIds.add(flagId);
      rows.push(`
        <tr class="${isNew && knownFlagIds.size > 1 ? "new-row" : ""}">
          <td class="mono">${String(n).padStart(2, "0")}</td>
          <td class="mono">${decodeBytes32Safe(flag.id)}</td>
          <td class="mono">${decodeBytes32Safe(flag.recordId)}</td>
          <td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
          <td>${flag.evidence}</td>
        </tr>
      `);
    }
    myFlagsBody.innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="5">You haven't flagged anything yet.</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
if (GOVCHAIN_CONFIG.CONTRACT_ADDRESS.startsWith("PASTE_")) {
  showStatus(verifyStatus, "Config not set — edit frontend/shared/config.js first.", "err");
} else {
  initReadOnlyContract();
  refreshDashboardStats();
  refreshRecent();
  readContract.on("RecordAnchored", () => { refreshDashboardStats(); refreshRecent(); });
  readContract.on("DiscrepancyFlagged", () => refreshDashboardStats());
  readContract.on("FlagStatusChanged", () => refreshDashboardStats());
}