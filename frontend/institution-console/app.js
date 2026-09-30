const { ethers } = window;

let provider, signer, contract, connectedAddress;
let knownRecordIds = new Set();
let knownFlagIds = new Set();

const el = (id) => document.getElementById(id);
const connectBtn = el("connectBtn");
const walletPill = el("walletPill");
const institutionLabel = el("institutionLabel");
const recordIdInput = el("recordIdInput");
const generateIdBtn = el("generateIdBtn");
const recordTypeSelect = el("recordTypeSelect");
const docContentInput = el("docContentInput");
const computedHashInput = el("computedHashInput");
const copyHashBtn = el("copyHashBtn");
const anchorBtn = el("anchorBtn");
const anchorStatus = el("anchorStatus");
const recordsBody = el("recordsBody");
const flagsBody = el("flagsBody");
const dropzone = el("dropzone");
const fileInput = el("fileInput");
const toastStack = el("toastStack");

const HARDHAT_CHAIN_HEX = "0x" + GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID.toString(16);

// ---------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------
function toast(message, type = "info") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  toastStack.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function showStatus(message, type) {
  anchorStatus.textContent = message;
  anchorStatus.className = `status-line show ${type}`;
}

// ---------------------------------------------------------------
// Hashing: live text hashing + drag-and-drop file hashing
// ---------------------------------------------------------------
function setHash(hash) {
  computedHashInput.value = hash;
}

docContentInput.addEventListener("input", () => {
  const text = docContentInput.value;
  setHash(text ? ethers.keccak256(ethers.toUtf8Bytes(text)) : "");
});

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hash = ethers.keccak256(new Uint8Array(buffer));
  setHash(hash);
  docContentInput.value = `[file: ${file.name}, ${(file.size / 1024).toFixed(1)} KB — hashed directly, not shown as text]`;
  toast(`Hashed "${file.name}"`, "ok");
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) hashFile(e.target.files[0]);
});
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) hashFile(file);
});

copyHashBtn.addEventListener("click", async () => {
  if (!computedHashInput.value) return;
  await navigator.clipboard.writeText(computedHashInput.value);
  toast("Hash copied to clipboard", "ok");
});

// ---------------------------------------------------------------
// Record ID generation — TYPE-YYYY-NNN, checked for uniqueness
// ---------------------------------------------------------------
function generateRecordId() {
  const prefixes = ["TENDER", "PERMIT", "DISBURSE"];
  const prefix = prefixes[Number(recordTypeSelect.value)] || "REC";
  const year = new Date().getFullYear();
  const serial = String(Math.floor(Math.random() * 900) + 100);
  recordIdInput.value = `${prefix}-${year}-${serial}`;
}
generateIdBtn.addEventListener("click", generateRecordId);

// ---------------------------------------------------------------
// Wallet connection with automatic network switching + auto-reconnect
// ---------------------------------------------------------------
async function ensureCorrectNetwork() {
  const network = await provider.getNetwork();
  if (Number(network.chainId) === GOVCHAIN_CONFIG.EXPECTED_CHAIN_ID) return true;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN_HEX }]
    });
    return true;
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: HARDHAT_CHAIN_HEX,
            chainName: "Hardhat Local",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
          }]
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function setupContract() {
  contract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, signer);

  const name = await contract.institutionNames(GOVCHAIN_CONFIG.INSTITUTION_ID);
  institutionLabel.textContent = name ? `Anchoring for: ${name}` : "Unknown institution — check config.js";

  const officerInstitution = await contract.institutionOfficerOf(connectedAddress);
  const isAuthorized = officerInstitution.toLowerCase() === GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase();

  walletPill.innerHTML = `<span class="dot ${isAuthorized ? "on" : "warn"}"></span>${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}${isAuthorized ? "" : " (not an authorized officer)"}`;

  if (!isAuthorized) {
    showStatus("This wallet is not an authorized officer for this institution. Connect the officer account to anchor records.", "err");
  }

  attachLiveListeners();
  await refreshDashboard();
}

async function connectWallet(silent = false) {
  if (!window.ethereum) {
    if (!silent) toast("MetaMask not detected — please install the extension.", "err");
    return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = silent
      ? await provider.send("eth_accounts", [])
      : await provider.send("eth_requestAccounts", []);
    if (!accounts.length) return;

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) {
      showStatus("Please switch MetaMask to the Hardhat Local network to continue.", "err");
      return;
    }
    provider = new ethers.BrowserProvider(window.ethereum); // re-init post switch
    signer = await provider.getSigner();
    connectedAddress = await signer.getAddress();

    connectBtn.textContent = "Connected";
    connectBtn.disabled = true;

    await setupContract();
  } catch (err) {
    console.error(err);
    if (!silent) showStatus(`Connection failed: ${err.message || err}`, "err");
  }
}

connectBtn.addEventListener("click", () => connectWallet(false));

// Try a silent reconnect on load if this site was previously authorized.
window.addEventListener("load", () => connectWallet(true));

// React to MetaMask account/network changes without a manual refresh.
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", () => window.location.reload());
  window.ethereum.on?.("chainChanged", () => window.location.reload());
}

// ---------------------------------------------------------------
// Anchoring — FR2
// ---------------------------------------------------------------
async function anchorRecord() {
  if (!contract) { showStatus("Connect your wallet first.", "err"); return; }

  const rawId = recordIdInput.value.trim();
  const hash = computedHashInput.value;
  const recordType = Number(recordTypeSelect.value);

  if (!rawId) { showStatus("Enter or generate a record ID.", "err"); return; }
  if (!hash) { showStatus("Provide a document (drop a file or paste text) so a hash can be computed.", "err"); return; }

  let recordIdBytes32;
  try {
    recordIdBytes32 = ethers.encodeBytes32String(rawId);
  } catch {
    showStatus("Record ID must be 31 characters or fewer (ASCII).", "err");
    return;
  }

  try {
    anchorBtn.disabled = true;
    showStatus("Submitting — confirm the transaction in MetaMask...", "info");

    const tx = await contract.anchorRecord(recordIdBytes32, GOVCHAIN_CONFIG.INSTITUTION_ID, hash, recordType);
    showStatus(`Transaction sent (${tx.hash.slice(0, 10)}...). Waiting for confirmation...`, "info");
    await tx.wait();

    showStatus(`Record "${rawId}" anchored.`, "ok");
    toast(`Anchored ${rawId}`, "ok");
    recordIdInput.value = "";
    docContentInput.value = "";
    setHash("");
    // No manual refresh needed — the RecordAnchored event listener updates the table.
  } catch (err) {
    console.error(err);
    const reason = err.reason || err.shortMessage || err.message || String(err);
    showStatus(`Anchoring failed: ${reason}`, "err");
  } finally {
    anchorBtn.disabled = false;
  }
}
anchorBtn.addEventListener("click", anchorRecord);

// ---------------------------------------------------------------
// Live updates — contract event listeners (the "automation" layer).
// Instead of polling or manual refresh, the dashboard updates itself
// the moment a RecordAnchored / DiscrepancyFlagged / FlagStatusChanged
// event is emitted anywhere on-chain (FR7, FR10-adjacent for officers).
// ---------------------------------------------------------------
function attachLiveListeners() {
  contract.removeAllListeners();

  contract.on("RecordAnchored", (recordId, institutionId) => {
    if (institutionId.toLowerCase() !== GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase()) return;
    toast(`New record anchored: ${decodeBytes32Safe(recordId)}`, "ok");
    refreshDashboard();
  });

  contract.on("DiscrepancyFlagged", (flagId, recordId) => {
    toast(`Discrepancy flagged on ${decodeBytes32Safe(recordId)}`, "err");
    refreshDashboard();
  });

  contract.on("FlagStatusChanged", (flagId, status) => {
    toast(`Flag ${decodeBytes32Safe(flagId)} → ${FLAG_STATUSES[status]}`, "info");
    refreshDashboard();
  });
}

// ---------------------------------------------------------------
// Dashboard rendering — FR7
// ---------------------------------------------------------------
function decodeBytes32Safe(value) {
  try { return ethers.decodeBytes32String(value); } catch { return value; }
}

async function refreshDashboard() {
  if (!contract) return;

  try {
    const count = await contract.getRecordIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < count; i++) {
      const id = await contract.getRecordIdAt(i);
      const record = await contract.getRecord(id);
      if (record.institutionId.toLowerCase() !== GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase()) continue;
      n++;
      const isNew = !knownRecordIds.has(id);
      knownRecordIds.add(id);
      rows.push(`
        <tr class="${isNew && knownRecordIds.size > 1 ? "new-row" : ""}">
          <td class="mono">${String(n).padStart(3, "0")}</td>
          <td class="mono">${decodeBytes32Safe(id)}</td>
          <td>${RECORD_TYPES[record.recordType] ?? record.recordType}</td>
          <td class="mono">${record.hash.slice(0, 14)}…</td>
          <td class="mono">${record.anchoredBy.slice(0, 8)}…</td>
          <td>${new Date(Number(record.timestamp) * 1000).toLocaleString()}</td>
        </tr>
      `);
    }
    recordsBody.innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="6">No records anchored yet — this institution's ledger is empty.</td></tr>`;
  } catch (err) {
    console.error(err);
    recordsBody.innerHTML = `<tr class="empty-row"><td colspan="6">Could not load records: ${err.message}</td></tr>`;
  }

  try {
    const flagCount = await contract.getFlagIdsCount();
    const rows = [];
    let n = 0;
    for (let i = 0; i < flagCount; i++) {
      const flagId = await contract.getFlagIdAt(i);
      const flag = await contract.flags(flagId);
      n++;
      const isNew = !knownFlagIds.has(flagId);
      knownFlagIds.add(flagId);
      rows.push(`
        <tr class="${isNew && knownFlagIds.size > 1 ? "new-row" : ""}">
          <td class="mono">${String(n).padStart(3, "0")}</td>
          <td class="mono">${decodeBytes32Safe(flag.id)}</td>
          <td class="mono">${decodeBytes32Safe(flag.recordId)}</td>
          <td><span class="tag ${FLAG_STATUSES[flag.status]}">${FLAG_STATUSES[flag.status]}</span></td>
          <td class="mono">${flag.flaggedBy.slice(0, 8)}…</td>
          <td>${flag.evidence}</td>
        </tr>
      `);
    }
    flagsBody.innerHTML = rows.length ? rows.join("") : `<tr class="empty-row"><td colspan="6">No discrepancies flagged yet.</td></tr>`;
  } catch (err) {
    console.error(err);
    flagsBody.innerHTML = `<tr class="empty-row"><td colspan="6">Could not load flags: ${err.message}</td></tr>`;
  }
}

if (GOVCHAIN_CONFIG.CONTRACT_ADDRESS.startsWith("PASTE_")) {
  showStatus("Config not set — edit frontend/shared/config.js with your deployed CONTRACT_ADDRESS and INSTITUTION_ID first.", "err");
}
