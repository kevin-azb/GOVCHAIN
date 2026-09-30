// Auto-derived from contracts/GovChainVerification.sol.
// If you change the contract, update this ABI to match (and re-deploy).
const GOVCHAIN_ABI = [
  "function admin() view returns (address)",
  "function institutionNames(bytes32) view returns (string)",
  "function institutionOfficerOf(address) view returns (bytes32)",
  "function isReviewPanelMember(address) view returns (bool)",
  "function reputationBalance(address) view returns (uint256)",

  "function anchorRecord(bytes32 recordId, bytes32 institutionId, bytes32 hash, uint8 recordType)",
  "function totalRecords() view returns (uint256)",
  "function getRecordIdsCount() view returns (uint256)",
  "function getRecordIdAt(uint256 index) view returns (bytes32)",
  "function getFlagIdsCount() view returns (uint256)",
  "function getFlagIdAt(uint256 index) view returns (bytes32)",

  "function flagDiscrepancy(bytes32 flagId, bytes32 recordId, string evidence)",
  "function resolveFlag(bytes32 flagId, uint8 newStatus)",

  "function getRecord(bytes32 recordId) view returns (tuple(bytes32 id, bytes32 hash, uint8 recordType, bytes32 institutionId, address anchoredBy, uint256 timestamp, bool exists))",
  "function verifyRecord(bytes32 recordId, bytes32 candidateHash) view returns (bool matches, tuple(bytes32 id, bytes32 hash, uint8 recordType, bytes32 institutionId, address anchoredBy, uint256 timestamp, bool exists) record)",
  "function flags(bytes32) view returns (bytes32 id, bytes32 recordId, address flaggedBy, string evidence, uint8 status, uint256 createdAt, bool exists)",

  "event RecordAnchored(bytes32 indexed recordId, bytes32 indexed institutionId, bytes32 hash, uint8 recordType, address anchoredBy, uint256 timestamp)",
  "event DiscrepancyFlagged(bytes32 indexed flagId, bytes32 indexed recordId, address indexed flaggedBy, string evidence, uint256 timestamp)",
  "event FlagStatusChanged(bytes32 indexed flagId, uint8 status, address indexed reviewedBy, uint256 timestamp)",
  "event ReputationTokenAwarded(address indexed citizen, uint256 amount, bytes32 indexed flagId)"
];

const RECORD_TYPES = ["TenderAward", "PermitApproval", "BudgetDisbursement"];
const FLAG_STATUSES = ["Investigating", "Resolved", "Disputed", "Confirmed"];
