const { ethers } = window;

let readContract;
let loadedRecords = [];

const el = (id) => document.getElementById(id);
const fromDate = el("fromDate");
const toDate = el("toDate");
const loadBtn = el("loadBtn");
const exportCsvBtn = el("exportCsvBtn");
const exportJsonBtn = el("exportJsonBtn");
const exportStatus = el("exportStatus");
const recordsBody = el("recordsBody");
const matchCount = el("matchCount");

function showStatus(message, type) {
  exportStatus.textContent = message;
  exportStatus.className = `status-line show ${type}`;
}
function decodeBytes32Safe(value) {
  try { return ethers.decodeBytes32String(value); } catch { return value; }
}

function initReadOnlyContract() {
  const rpc = new ethers.JsonRpcProvider(GOVCHAIN_CONFIG.READ_ONLY_RPC_URL || "http://127.0.0.1:8545");
  readContract = new ethers.Contract(GOVCHAIN_CONFIG.CONTRACT_ADDRESS, GOVCHAIN_ABI, rpc);
}

async function loadRecords() {
  const fromTs = fromDate.value ? Math.floor(new Date(fromDate.value + "T00:00:00").getTime() / 1000) : 0;
  const toTs = toDate.value ? Math.floor(new Date(toDate.value + "T23:59:59").getTime() / 1000) : Number.MAX_SAFE_INTEGER;

  try {
    loadBtn.disabled = true;
    showStatus("Reading anchored records from the chain...", "info");

    const count = await readContract.getRecordIdsCount();
    loadedRecords = [];

    for (let i = 0; i < count; i++) {
      const id = await readContract.getRecordIdAt(i);
      const record = await readContract.getRecord(id);
      const ts = Number(record.timestamp);
      if (record.institutionId.toLowerCase() !== GOVCHAIN_CONFIG.INSTITUTION_ID.toLowerCase()) continue;
      if (ts < fromTs || ts > toTs) continue;

      const institutionName = await readContract.institutionNames(record.institutionId);
      loadedRecords.push({
        recordId: decodeBytes32Safe(id),
        type: RECORD_TYPES[record.recordType] ?? String(record.recordType),
        hash: record.hash,
        institution: institutionName,
        anchoredBy: record.anchoredBy,
        timestamp: new Date(ts * 1000).toISOString()
      });
    }

    renderTable();
    matchCount.textContent = `${loadedRecords.length} RECORD${loadedRecords.length === 1 ? "" : "S"} MATCHED`;
    exportCsvBtn.disabled = loadedRecords.length === 0;
    exportJsonBtn.disabled = loadedRecords.length === 0;
    showStatus(`Loaded ${loadedRecords.length} record(s).`, "ok");
  } catch (err) {
    console.error(err);
    showStatus(`Failed to load: ${err.message}`, "err");
  } finally {
    loadBtn.disabled = false;
  }
}
loadBtn.addEventListener("click", loadRecords);

function renderTable() {
  if (!loadedRecords.length) {
    recordsBody.innerHTML = `<tr class="empty-row"><td colspan="6">No records anchored in this date range.</td></tr>`;
    return;
  }
  recordsBody.innerHTML = loadedRecords.map((r, i) => `
    <tr>
      <td class="mono">${String(i + 1).padStart(3, "0")}</td>
      <td class="mono">${r.recordId}</td>
      <td>${r.type}</td>
      <td class="mono">${r.hash.slice(0, 18)}…</td>
      <td class="mono">${r.anchoredBy.slice(0, 10)}…</td>
      <td>${new Date(r.timestamp).toLocaleString()}</td>
    </tr>
  `).join("");
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportCsvBtn.addEventListener("click", () => {
  const header = "Record ID,Type,Hash,Institution,Anchored By,Timestamp\n";
  const rows = loadedRecords.map((r) =>
    [r.recordId, r.type, r.hash, r.institution, r.anchoredBy, r.timestamp]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  ).join("\n");
  downloadBlob(header + rows, `govchain-audit-${Date.now()}.csv`, "text/csv");
});

exportJsonBtn.addEventListener("click", () => {
  downloadBlob(JSON.stringify(loadedRecords, null, 2), `govchain-audit-${Date.now()}.json`, "application/json");
});

if (GOVCHAIN_CONFIG.CONTRACT_ADDRESS.startsWith("PASTE_")) {
  showStatus("Config not set — edit frontend/shared/config.js first.", "err");
} else {
  initReadOnlyContract();
}