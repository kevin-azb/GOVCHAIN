const { ethers } = window;

const el = (id) => document.getElementById(id);
const HARDHAT_CHAIN_HEX = "0x" + GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID.toString(16);

let walletProvider, signer, writeContract, connectedAddress;
let readContract; // works with no wallet — used for citizen verification (FR3) and audit export
let isOfficer = false, isReviewer = false;

let inst_pendingHash = "", cit_pendingHash = "";
let cit_lastVerifiedRecordId = null;
let knownInstRecordIds = new Set(), knownInstFlagIds = new Set();
let knownCitRecentIds = new Set(), knownCitFlagIds = new Set();
let aud_loadedRecords = [];

const toastStack = el("toastStack");
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
// Tab navigation
// ---------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    el(`panel-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------------------------------------------------------------
// Read-only contract — works even with no wallet installed
// ---------------------------------------------------------------
function initReadOnlyContract() {
  const rpc = new ethers.JsonRpcProvider(GOVCHAIN_CONFIG.READ_ONLY_RPC_URL || "http://127.0.0.1:8545");
  readContract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, rpc);
}

// ---------------------------------------------------------------
// Wallet connection (shared across all four roles)
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
          params: [{ chainId: HARDHAT_CHAIN_HEX, chainName: "Hardhat Local", rpcUrls: [GOVCHAIN_CONFIG.READ_ONLY_RPC_URL || "http://127.0.0.1:8545"], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }]
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function connectWallet(silent = false) {
  if (!window.ethereum) {
    if (!silent) toast("No wallet detected — verification still works without one.", "info");
    return;
  }
  try {
    walletProvider = new ethers.BrowserProvider(window.ethereum);
    const accounts = silent ? await walletProvider.send("eth_accounts", []) : await walletProvider.send("eth_requestAccounts", []);
    if (!accounts.length) return;

    const ok = await ensureCorrectNetwork();
    if (!ok) { toast("Switch MetaMask to Hardhat Local to continue.", "err"); return; }

    walletProvider = new ethers.BrowserProvider(window.ethereum);
    signer = await walletProvider.getSigner();
    connectedAddress = await signer.getAddress();
    writeContract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, signer);

    el("connectBtn").textContent = "Connected";
    el("connectBtn").disabled = true;

    const officerInstitution = await readContract.institutionOfficerOf(connectedAddress);
    isOfficer = officerInstitution.toLowerCase() === GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase();
    isReviewer = await readContract.isReviewPanelMember(connectedAddress);

    const roleLabel = isOfficer ? "Institution Officer" : isReviewer ? "Review Panel Member" : "Citizen";
    el("walletPill").innerHTML = `<span class="dot on"></span>${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`;
    el("roleNote").textContent = `Connected as: ${roleLabel} (${connectedAddress}). Every tab is visible regardless of role, but actions are gated on-chain — the contract itself rejects unauthorized transactions.`;

    const reputation = await readContract.reputationBalance(connectedAddress);
    el("reputationPill").style.display = "flex";
    el("reputationValue").textContent = reputation.toString();

    el("cit_myFlagsSection").style.display = "block";

    attachLiveListeners();
    await Promise.all([refreshInstitution(), refreshCitizen(), refreshCitizenMyFlags(), refreshReview()]);
  } catch (err) {
    console.error(err);
    if (!silent) toast(`Connection failed: ${err.message || err}`, "err");
  }
}
el("connectBtn").addEventListener("click", () => connectWallet(false));
window.addEventListener("load", () => { initReadOnlyContract(); refreshCitizen(); refreshAudit_init(); connectWallet(true); });
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

// ---------------------------------------------------------------
// Live event listeners (shared)
// ---------------------------------------------------------------
function attachLiveListeners() {
  readContract.removeAllListeners();

  readContract.on("RecordAnchored", () => { refreshInstitution(); refreshCitizen(); });

  readContract.on("DiscrepancyFlagged", async (flagId, recordId, flaggedBy) => {
    refreshInstitution();
    refreshReview();
    if (connectedAddress && flaggedBy.toLowerCase() === connectedAddress.toLowerCase()) refreshCitizenMyFlags();
    toast(`New discrepancy flagged on ${decodeBytes32Safe(recordId)}`, "err");
  });

  readContract.on("FlagStatusChanged", async (flagId, status) => {
    refreshInstitution();
    refreshReview();
    if (!connectedAddress) return;
    const flag = await readContract.flags(flagId);
    if (flag.flaggedBy.toLowerCase() === connectedAddress.toLowerCase()) {
      toast(`Your flag on ${decodeBytes32Safe(flag.recordId)} is now: ${FLAG_STATUSES[status]}`, Number(status) === 3 ? "ok" : "info");
      refreshCitizenMyFlags();
      const reputation = await readContract.reputationBalance(connectedAddress);
      el("reputationValue").textContent = reputation.toString();
    }
  });

  readContract.on("ReputationTokenAwarded", (citizen, amount) => {
    if (connectedAddress && citizen.toLowerCase() === connectedAddress.toLowerCase()) {
      toast(`You earned ${amount} reputation tokens!`, "ok");
    }
  });
}

// =================================================================
// INSTITUTION CONSOLE
// =================================================================
el("inst_docContent").addEventListener("input", () => {
  const text = el("inst_docContent").value;
  inst_pendingHash = text ? ethers.keccak256(ethers.toUtf8Bytes(text)) : "";
  el("inst_computedHash").value = inst_pendingHash;
});
async function inst_hashFile(file) {
  const buffer = await file.arrayBuffer();
  inst_pendingHash = ethers.keccak256(new Uint8Array(buffer));
  el("inst_computedHash").value = inst_pendingHash;
  el("inst_docContent").value = `[file: ${file.name}, ${(file.size / 1024).toFixed(1)} KB — hashed directly]`;
  toast(`Hashed "${file.name}"`, "ok");
}
el("inst_dropzone").addEventListener("click", () => el("inst_fileInput").click());
el("inst_fileInput").addEventListener("change", (e) => { if (e.target.files[0]) inst_hashFile(e.target.files[0]); });
["dragenter", "dragover"].forEach((evt) => el("inst_dropzone").addEventListener(evt, (e) => { e.preventDefault(); el("inst_dropzone").classList.add("drag"); }));
["dragleave", "drop"].forEach((evt) => el("inst_dropzone").addEventListener(evt, (e) => { e.preventDefault(); el("inst_dropzone").classList.remove("drag"); }));
el("inst_dropzone").addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) inst_hashFile(f); });
el("inst_copyHash").addEventListener("click", async () => { if (inst_pendingHash) { await navigator.clipboard.writeText(inst_pendingHash); toast("Hash copied", "ok"); } });
el("inst_generateId").addEventListener("click", () => {
  const prefixes = ["TENDER", "PERMIT", "DISBURSE"];
  const prefix = prefixes[Number(el("inst_recordType").value)] || "REC";
  el("inst_recordId").value = `${prefix}-${new Date().getFullYear()}-${Math.floor(Math.random() * 900) + 100}`;
});

el("inst_anchorBtn").addEventListener("click", async () => {
  if (!writeContract) { showStatus(el("inst_status"), "Connect your wallet first.", "err"); return; }
  const rawId = el("inst_recordId").value.trim();
  const recordType = Number(el("inst_recordType").value);
  if (!rawId) { showStatus(el("inst_status"), "Enter or generate a record ID.", "err"); return; }
  if (!inst_pendingHash) { showStatus(el("inst_status"), "Provide a document first.", "err"); return; }

  let recordIdBytes32;
  try { recordIdBytes32 = ethers.encodeBytes32String(rawId); } catch { showStatus(el("inst_status"), "Record ID too long (≤31 chars).", "err"); return; }

  try {
    el("inst_anchorBtn").disabled = true;
    showStatus(el("inst_status"), "Submitting — confirm in MetaMask...", "info");
    const tx = await writeContract.anchorRecord(recordIdBytes32, GOVCHAIN_CONFIG.INSTITUTION_ID, inst_pendingHash, recordType);
    showStatus(el("inst_status"), "Waiting for confirmation...", "info");
    await tx.wait();
    showStatus(el("inst_status"), `Record "${rawId}" anchored.`, "ok");
    toast(`Anchored ${rawId}`, "ok");
    el("inst_recordId").value = ""; el("inst_docContent").value = ""; el("inst_computedHash").value = ""; inst_pendingHash = "";
  } catch (err) {
    console.error(err);
    showStatus(el("inst_status"), `Anchoring failed: ${err.reason || err.shortMessage || err.message}`, "err");
  } finally {
    el("inst_anchorBtn").disabled = false;
  }
});

async function refreshInstitution() {
  if (!readContract) return;
  try {
    const count = await readContract.getRecordIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < count; i++) {
      const id = await readContract.getRecordIdAt(i);
      const record = await readContract.getRecord(id);
      if (record.institutionId.toLowerCase() !== GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase()) continue;
      n++;
      const isNew = !knownInstRecordIds.has(id);
      knownInstRecordIds.add(id);
      rows.push(`<tr class="${isNew && knownInstRecordIds.size > 1 ? "new-row" : ""}">
        <td class="mono">${String(n).padStart(3, "0")}</td><td class="mono">${decodeBytes32Safe(id)}</td>
        <td>${RECORD_TYPES[record.recordType] ?? record.recordType}</td><td class="mono">${record.hash.slice(0, 14)}…</td>
        <td class="mono">${record.anchoredBy.slice(0, 8)}…</td><td>${new Date(Number(record.timestamp) * 1000).toLocaleString()}</td></tr>`);
    }
    el("inst_recordsBody").innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="6">No records anchored yet.</td></tr>`;
  } catch (err) { console.error(err); }

  try {
    const flagCount = await readContract.getFlagIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      n++;
      const isNew = !knownInstFlagIds.has(flagId);
      knownInstFlagIds.add(flagId);
      rows.push(`<tr class="${isNew && knownInstFlagIds.size > 1 ? "new-row" : ""}">
        <td class="mono">${String(n).padStart(3, "0")}</td><td class="mono">${decodeBytes32Safe(flag.id)}</td>
        <td class="mono">${decodeBytes32Safe(flag.recordId)}</td><td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
        <td class="mono">${flag.flaggedBy.slice(0, 8)}…</td><td>${flag.evidence}</td></tr>`);
    }
    el("inst_flagsBody").innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="6">No discrepancies flagged yet.</td></tr>`;
  } catch (err) { console.error(err); }
}

// =================================================================
// CITIZEN APP
// =================================================================
el("cit_docContent").addEventListener("input", () => {
  const text = el("cit_docContent").value;
  cit_pendingHash = text ? ethers.keccak256(ethers.toUtf8Bytes(text)) : "";
});
async function cit_hashFile(file) {
  const buffer = await file.arrayBuffer();
  cit_pendingHash = ethers.keccak256(new Uint8Array(buffer));
  el("cit_docContent").value = `[file: ${file.name}, ${(file.size / 1024).toFixed(1)} KB — hashed directly]`;
  toast(`Hashed "${file.name}"`, "ok");
}
el("cit_dropzone").addEventListener("click", () => el("cit_fileInput").click());
el("cit_fileInput").addEventListener("change", (e) => { if (e.target.files[0]) cit_hashFile(e.target.files[0]); });
["dragenter", "dragover"].forEach((evt) => el("cit_dropzone").addEventListener(evt, (e) => { e.preventDefault(); el("cit_dropzone").classList.add("drag"); }));
["dragleave", "drop"].forEach((evt) => el("cit_dropzone").addEventListener(evt, (e) => { e.preventDefault(); el("cit_dropzone").classList.remove("drag"); }));
el("cit_dropzone").addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) cit_hashFile(f); });

el("cit_verifyBtn").addEventListener("click", async () => {
  const rawId = el("cit_recordId").value.trim();
  if (!rawId) { showStatus(el("cit_verifyStatus"), "Enter a record ID.", "err"); return; }
  if (!cit_pendingHash) { showStatus(el("cit_verifyStatus"), "Provide the document to check.", "err"); return; }

  let recordIdBytes32;
  try { recordIdBytes32 = ethers.encodeBytes32String(rawId); } catch { showStatus(el("cit_verifyStatus"), "Record ID too long.", "err"); return; }

  try {
    el("cit_verifyBtn").disabled = true;
    showStatus(el("cit_verifyStatus"), "Checking against the chain...", "info");
    const [matches, record] = await readContract.verifyRecord(recordIdBytes32, cit_pendingHash);
    const institutionName = await readContract.institutionNames(record.institutionId);

    const resultBox = el("cit_verifyResult");
    resultBox.classList.add("show");
    cit_lastVerifiedRecordId = rawId;

    if (matches) {
      resultBox.className = "verify-result show match";
      el("cit_verifyResultTitle").textContent = "✓ Verified — records match";
      el("cit_verifyResultDetail").innerHTML = `Anchored by <span class="mono">${institutionName}</span> on ${new Date(Number(record.timestamp) * 1000).toLocaleString()}.`;
      el("cit_flagPrompt").innerHTML = "";
    } else {
      resultBox.className = "verify-result show mismatch";
      el("cit_verifyResultTitle").textContent = "✕ Mismatch — doesn't match what was anchored";
      el("cit_verifyResultDetail").innerHTML = `Anchored hash: <span class="mono">${record.hash.slice(0, 18)}…</span><br/>Your document's hash: <span class="mono">${cit_pendingHash.slice(0, 18)}…</span>`;
      el("cit_flagPrompt").innerHTML = `<button id="cit_openFlagBtn">Flag This Discrepancy</button>`;
      el("cit_openFlagBtn").addEventListener("click", () => {
        el("cit_flagSection").style.display = "block";
        el("cit_flagSection").scrollIntoView({ behavior: "smooth" });
      });
    }
    showStatus(el("cit_verifyStatus"), "Done.", "ok");
  } catch (err) {
    console.error(err);
    const reason = err.reason || err.shortMessage || err.message || String(err);
    showStatus(el("cit_verifyStatus"), reason.includes("record not found") ? `No record found with ID "${rawId}".` : `Verification failed: ${reason}`, "err");
    el("cit_verifyResult").classList.remove("show");
  } finally {
    el("cit_verifyBtn").disabled = false;
  }
});

el("cit_submitFlagBtn").addEventListener("click", async () => {
  if (!writeContract) { showStatus(el("cit_flagStatus"), "Connect your wallet first.", "err"); return; }
  const evidence = el("cit_evidence").value.trim();
  if (!evidence) { showStatus(el("cit_flagStatus"), "Describe the discrepancy first.", "err"); return; }
  if (!cit_lastVerifiedRecordId) { showStatus(el("cit_flagStatus"), "Verify a record above before flagging it.", "err"); return; }

  const recordIdBytes32 = ethers.encodeBytes32String(cit_lastVerifiedRecordId);
  const flagId = ethers.encodeBytes32String(`F-${Date.now().toString(36).slice(-10).toUpperCase()}`);

  try {
    el("cit_submitFlagBtn").disabled = true;
    showStatus(el("cit_flagStatus"), "Submitting — confirm in MetaMask...", "info");
    const tx = await writeContract.flagDiscrepancy(flagId, recordIdBytes32, evidence);
    showStatus(el("cit_flagStatus"), "Waiting for confirmation...", "info");
    await tx.wait();
    showStatus(el("cit_flagStatus"), "Flag submitted.", "ok");
    toast("Discrepancy flagged — thank you.", "ok");
    el("cit_evidence").value = "";
  } catch (err) {
    console.error(err);
    showStatus(el("cit_flagStatus"), `Failed: ${err.reason || err.shortMessage || err.message}`, "err");
  } finally {
    el("cit_submitFlagBtn").disabled = false;
  }
});

async function refreshCitizen() {
  if (!readContract) return;
  try {
    const totalRecords = await readContract.totalRecords();
    el("cit_statRecords").textContent = totalRecords.toString();
    const flagCount = await readContract.getFlagIdsCount();
    el("cit_statFlags").textContent = flagCount.toString();

    let resolvedCount = 0, totalResolutionSeconds = 0n;
    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      if (Number(flag.status) === 0) continue;
      resolvedCount++;
      const events = await readContract.queryFilter(readContract.filters.FlagStatusChanged(flagId));
      if (events.length) totalResolutionSeconds += (events[events.length - 1].args.timestamp - flag.createdAt);
    }
    el("cit_statResolved").textContent = resolvedCount.toString();
    if (resolvedCount > 0) {
      const avgSeconds = Number(totalResolutionSeconds / BigInt(resolvedCount));
      el("cit_statAvgTime").textContent = avgSeconds < 60 ? `${avgSeconds}s` : avgSeconds < 3600 ? `${Math.round(avgSeconds / 60)}m` : `${(avgSeconds / 3600).toFixed(1)}h`;
    } else {
      el("cit_statAvgTime").textContent = "—";
    }

    const count = await readContract.getRecordIdsCount();
    const rows = [];
    const start = Math.max(0, Number(count) - 15);
    for (let i = Number(count) - 1; i >= start; i--) {
      const id = await readContract.getRecordIdAt(i);
      const record = await readContract.getRecord(id);
      const institutionName = await readContract.institutionNames(record.institutionId);
      const isNew = !knownCitRecentIds.has(id);
      knownCitRecentIds.add(id);
      rows.push(`<tr class="${isNew && knownCitRecentIds.size > 1 ? "new-row" : ""}">
        <td class="mono">${String(i + 1).padStart(3, "0")}</td><td class="mono">${decodeBytes32Safe(id)}</td>
        <td>${RECORD_TYPES[record.recordType] ?? record.recordType}</td><td>${institutionName}</td>
        <td>${new Date(Number(record.timestamp) * 1000).toLocaleString()}</td></tr>`);
    }
    el("cit_recentBody").innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="5">No records anchored yet.</td></tr>`;
  } catch (err) { console.error(err); }
}

async function refreshCitizenMyFlags() {
  if (!connectedAddress || !readContract) return;
  try {
    const flagCount = await readContract.getFlagIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      if (flag.flaggedBy.toLowerCase() !== connectedAddress.toLowerCase()) continue;
      n++;
      const isNew = !knownCitFlagIds.has(flagId);
      knownCitFlagIds.add(flagId);
      rows.push(`<tr class="${isNew && knownCitFlagIds.size > 1 ? "new-row" : ""}">
        <td class="mono">${String(n).padStart(2, "0")}</td><td class="mono">${decodeBytes32Safe(flag.id)}</td>
        <td class="mono">${decodeBytes32Safe(flag.recordId)}</td><td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
        <td>${flag.evidence}</td></tr>`);
    }
    el("cit_myFlagsBody").innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="5">You haven't flagged anything yet.</td></tr>`;
  } catch (err) { console.error(err); }
}

// =================================================================
// REVIEW PANEL
// =================================================================
async function rev_resolveFlag(flagId, status, btn) {
  try {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Confirm in MetaMask...";
    const tx = await writeContract.resolveFlag(flagId, status);
    btn.textContent = "Waiting for confirmation...";
    await tx.wait();
    toast(`Flag marked ${FLAG_STATUSES[status]}${status === 3 ? " — reputation token awarded" : ""}`, status === 3 ? "ok" : "info");
  } catch (err) {
    console.error(err);
    toast(`Action failed: ${err.reason || err.shortMessage || err.message}`, "err");
    btn.disabled = false;
    btn.textContent = btn.dataset.originalLabel;
  }
}

async function refreshReview() {
  if (!readContract) return;
  try {
    const flagCount = await readContract.getFlagIdsCount();
    const pendingCards = [];
    const historyRows = [];
    let historyN = 0;

    for (let i = 0; i < flagCount; i++) {
      const flagId = await readContract.getFlagIdAt(i);
      const flag = await readContract.flags(flagId);
      const record = await readContract.getRecord(flag.recordId).catch(() => null);
      const institutionName = record ? await readContract.institutionNames(record.institutionId) : "Unknown";

      if (Number(flag.status) === 0) {
        pendingCards.push(`
          <div class="flag-card">
            <div class="flag-card-head"><div>
              <div class="flag-card-id">FLAG ${decodeBytes32Safe(flag.id)}</div>
              <div class="flag-card-record">${decodeBytes32Safe(flag.recordId)}</div>
              <div class="flag-card-meta">${institutionName} · ${record ? RECORD_TYPES[record.recordType] : "—"} · Flagged by ${flag.flaggedBy.slice(0, 8)}… on ${new Date(Number(flag.createdAt) * 1000).toLocaleString()}</div>
            </div></div>
            <div class="flag-card-evidence">${flag.evidence}</div>
            ${record ? `<div class="hash-compare"><div class="hash-compare-item">Anchored hash<span class="mono">${record.hash}</span></div><div class="hash-compare-item">Anchored by<span class="mono">${record.anchoredBy}</span></div></div>` : ""}
            <div class="flag-card-actions">
              <button class="confirm" data-original-label="Confirm — Valid Discrepancy" data-flag="${flagId}" data-status="3">Confirm — Valid Discrepancy</button>
              <button class="dispute" data-original-label="Dispute — Not Valid" data-flag="${flagId}" data-status="2">Dispute — Not Valid</button>
              <button class="ghost resolve" data-original-label="Mark Resolved" data-flag="${flagId}" data-status="1">Mark Resolved</button>
            </div>
          </div>`);
      } else {
        historyN++;
        historyRows.push(`<tr><td class="mono">${String(historyN).padStart(3, "0")}</td><td class="mono">${decodeBytes32Safe(flag.id)}</td>
          <td class="mono">${decodeBytes32Safe(flag.recordId)}</td><td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
          <td class="mono">${flag.flaggedBy.slice(0, 8)}…</td></tr>`);
      }
    }

    el("rev_pendingList").innerHTML = pendingCards.length ? pendingCards.join("") : `<div class="flag-card"><span style="color:var(--text-faint); font-size:13px;">No flags awaiting review.</span></div>`;
    el("rev_historyBody").innerHTML = historyRows.length ? historyRows.join("") : `<tr class="empty-row"><td colspan="5">No reviewed flags yet.</td></tr>`;

    el("rev_pendingList").querySelectorAll("[data-flag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!writeContract) { toast("Connect your wallet first.", "err"); return; }
        rev_resolveFlag(btn.dataset.flag, Number(btn.dataset.status), btn);
      });
    });
  } catch (err) {
    console.error(err);
  }
}

// =================================================================
// AUDIT EXPORT
// =================================================================
function refreshAudit_init() { /* no-op, kept for symmetry — audit loads on demand */ }

el("aud_loadBtn").addEventListener("click", async () => {
  const fromTs = el("aud_fromDate").value ? Math.floor(new Date(el("aud_fromDate").value + "T00:00:00").getTime() / 1000) : 0;
  const toTs = el("aud_toDate").value ? Math.floor(new Date(el("aud_toDate").value + "T23:59:59").getTime() / 1000) : Number.MAX_SAFE_INTEGER;

  try {
    el("aud_loadBtn").disabled = true;
    showStatus(el("aud_status"), "Reading anchored records...", "info");
    const count = await readContract.getRecordIdsCount();
    aud_loadedRecords = [];
    for (let i = 0; i < count; i++) {
      const id = await readContract.getRecordIdAt(i);
      const record = await readContract.getRecord(id);
      const ts = Number(record.timestamp);
      if (record.institutionId.toLowerCase() !== GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase()) continue;
      if (ts < fromTs || ts > toTs) continue;
      const institutionName = await readContract.institutionNames(record.institutionId);
      aud_loadedRecords.push({
        recordId: decodeBytes32Safe(id), type: RECORD_TYPES[record.recordType] ?? String(record.recordType),
        hash: record.hash, institution: institutionName, anchoredBy: record.anchoredBy,
        timestamp: new Date(ts * 1000).toISOString()
      });
    }
    el("aud_recordsBody").innerHTML = aud_loadedRecords.length
      ? aud_loadedRecords.map((r, i) => `<tr><td class="mono">${String(i + 1).padStart(3, "0")}</td><td class="mono">${r.recordId}</td><td>${r.type}</td><td class="mono">${r.hash.slice(0, 18)}…</td><td class="mono">${r.anchoredBy.slice(0, 10)}…</td><td>${new Date(r.timestamp).toLocaleString()}</td></tr>`).join("")
      : `<tr class="empty-row"><td colspan="6">No records anchored in this date range.</td></tr>`;
    el("aud_matchCount").textContent = `${aud_loadedRecords.length} RECORD${aud_loadedRecords.length === 1 ? "" : "S"} MATCHED`;
    el("aud_exportCsvBtn").disabled = aud_loadedRecords.length === 0;
    el("aud_exportJsonBtn").disabled = aud_loadedRecords.length === 0;
    showStatus(el("aud_status"), `Loaded ${aud_loadedRecords.length} record(s).`, "ok");
  } catch (err) {
    console.error(err);
    showStatus(el("aud_status"), `Failed to load: ${err.message}`, "err");
  } finally {
    el("aud_loadBtn").disabled = false;
  }
});

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
el("aud_exportCsvBtn").addEventListener("click", () => {
  const header = "Record ID,Type,Hash,Institution,Anchored By,Timestamp\n";
  const rows = aud_loadedRecords.map((r) => [r.recordId, r.type, r.hash, r.institution, r.anchoredBy, r.timestamp].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadBlob(header + rows, `govchain-audit-${Date.now()}.csv`, "text/csv");
});
el("aud_exportJsonBtn").addEventListener("click", () => {
  downloadBlob(JSON.stringify(aud_loadedRecords, null, 2), `govchain-audit-${Date.now()}.json`, "application/json");
});

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
if (GOVCHAIN_CONFIG.CONTRACT_ADDRESS.startsWith("PASTE_")) {
  document.querySelectorAll(".status-line").forEach((s) => showStatus(s, "Config not set — edit frontend/shared/config.js first.", "err"));
}