// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GovChain Verification Layer
/// @notice Anchors public-sector record hashes and manages discrepancy flags,
///         reviews, and reputation-token rewards for the GovChain pilot.
/// @dev Maps to FR2 (Record Anchoring), FR3 (Public Verification), FR4 (Discrepancy
///      Flagging), FR5 (Flag Review), FR6 (Reputation Reward), FR9 (Audit Log Export).
///      Satisfies NFR1 (no keys ever touch this contract — every call is signed
///      client-side by the caller's wallet before submission) and NFR6 (every anchor
///      and flag is stored immutably and readable by anyone, with no permission gate).
contract GovChainVerification {
    // ---------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------

    address public admin;

    // institutionId => institution name (Institution class in the SRS class diagram)
    mapping(bytes32 => string) public institutionNames;

    // wallet address => institutionId it is authorized to anchor for (InstitutionOfficer)
    mapping(address => bytes32) public institutionOfficerOf;

    // wallet address => is an authorized Review Panel member
    mapping(address => bool) public isReviewPanelMember;

    modifier onlyAdmin() {
        require(msg.sender == admin, "GovChain: caller is not admin");
        _;
    }

    modifier onlyInstitutionOfficer(bytes32 institutionId) {
        require(
            institutionOfficerOf[msg.sender] == institutionId,
            "GovChain: caller is not an officer of this institution"
        );
        _;
    }

    modifier onlyReviewPanel() {
        require(isReviewPanelMember[msg.sender], "GovChain: caller is not a review panel member");
        _;
    }

    // ---------------------------------------------------------------
    // Records  (Record class in the SRS class diagram)
    // ---------------------------------------------------------------

    enum RecordType { TenderAward, PermitApproval, BudgetDisbursement }

    struct Record {
        bytes32 id;
        bytes32 hash;           // cryptographic hash of the published document
        RecordType recordType;
        bytes32 institutionId;
        address anchoredBy;
        uint256 timestamp;
        bool exists;
    }

    mapping(bytes32 => Record) public records;
    bytes32[] public recordIds; // supports FR9 audit-log export / enumeration

    // ---------------------------------------------------------------
    // Discrepancy Flags  (DiscrepancyFlag class in the SRS class diagram)
    // ---------------------------------------------------------------

    enum FlagStatus { Investigating, Resolved, Disputed, Confirmed }

    struct DiscrepancyFlag {
        bytes32 id;
        bytes32 recordId;
        address flaggedBy;
        string evidence;        // URI or hash pointer to supporting evidence
        FlagStatus status;
        uint256 createdAt;
        bool exists;
    }

    mapping(bytes32 => DiscrepancyFlag) public flags;
    bytes32[] public flagIds;

    // ---------------------------------------------------------------
    // Reputation Tokens (simple internal ledger, not a full ERC-20 for the pilot)
    // ---------------------------------------------------------------

    mapping(address => uint256) public reputationBalance;

    // ---------------------------------------------------------------
    // Events — these are what the off-chain indexer / Notification Service
    // in the component diagram listens to (FR10, Notification Service «use»).
    // ---------------------------------------------------------------

    event InstitutionRegistered(bytes32 indexed institutionId, string name);
    event OfficerAuthorized(bytes32 indexed institutionId, address indexed officer);
    event ReviewPanelMemberAdded(address indexed member);

    event RecordAnchored(
        bytes32 indexed recordId,
        bytes32 indexed institutionId,
        bytes32 hash,
        RecordType recordType,
        address anchoredBy,
        uint256 timestamp
    );

    event DiscrepancyFlagged(
        bytes32 indexed flagId,
        bytes32 indexed recordId,
        address indexed flaggedBy,
        string evidence,
        uint256 timestamp
    );

    event FlagStatusChanged(
        bytes32 indexed flagId,
        FlagStatus status,
        address indexed reviewedBy,
        uint256 timestamp
    );

    event ReputationTokenAwarded(address indexed citizen, uint256 amount, bytes32 indexed flagId);

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    constructor() {
        admin = msg.sender;
    }

    // ---------------------------------------------------------------
    // Admin setup functions
    // ---------------------------------------------------------------

    function registerInstitution(bytes32 institutionId, string calldata name) external onlyAdmin {
        require(bytes(institutionNames[institutionId]).length == 0, "GovChain: institution already exists");
        institutionNames[institutionId] = name;
        emit InstitutionRegistered(institutionId, name);
    }

    function authorizeOfficer(bytes32 institutionId, address officer) external onlyAdmin {
        require(bytes(institutionNames[institutionId]).length != 0, "GovChain: unknown institution");
        institutionOfficerOf[officer] = institutionId;
        emit OfficerAuthorized(institutionId, officer);
    }

    function addReviewPanelMember(address member) external onlyAdmin {
        isReviewPanelMember[member] = true;
        emit ReviewPanelMemberAdded(member);
    }

    // ---------------------------------------------------------------
    // FR2 — Record Anchoring
    // ---------------------------------------------------------------

    function anchorRecord(
        bytes32 recordId,
        bytes32 institutionId,
        bytes32 hash,
        RecordType recordType
    ) external onlyInstitutionOfficer(institutionId) {
        require(!records[recordId].exists, "GovChain: record already anchored");

        records[recordId] = Record({
            id: recordId,
            hash: hash,
            recordType: recordType,
            institutionId: institutionId,
            anchoredBy: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });
        recordIds.push(recordId);

        emit RecordAnchored(recordId, institutionId, hash, recordType, msg.sender, block.timestamp);
    }

    // ---------------------------------------------------------------
    // FR3 — Public Record Verification (pure read, no wallet required)
    // ---------------------------------------------------------------

    function verifyRecord(bytes32 recordId, bytes32 candidateHash)
        external
        view
        returns (bool matches, Record memory record)
    {
        record = records[recordId];
        require(record.exists, "GovChain: record not found");
        matches = (record.hash == candidateHash);
    }

    function getRecord(bytes32 recordId) external view returns (Record memory) {
        require(records[recordId].exists, "GovChain: record not found");
        return records[recordId];
    }

    function totalRecords() external view returns (uint256) {
        return recordIds.length;
    }

    // ---------------------------------------------------------------
    // FR4 — Discrepancy Flagging
    // ---------------------------------------------------------------

    function flagDiscrepancy(bytes32 flagId, bytes32 recordId, string calldata evidence) external {
        require(records[recordId].exists, "GovChain: cannot flag unknown record");
        require(!flags[flagId].exists, "GovChain: flag id already used");

        flags[flagId] = DiscrepancyFlag({
            id: flagId,
            recordId: recordId,
            flaggedBy: msg.sender,
            evidence: evidence,
            status: FlagStatus.Investigating,
            createdAt: block.timestamp,
            exists: true
        });
        flagIds.push(flagId);

        emit DiscrepancyFlagged(flagId, recordId, msg.sender, evidence, block.timestamp);
    }

    // ---------------------------------------------------------------
    // FR5 — Flag Review Workflow  (+ FR6 Reputation Reward on confirmation)
    // ---------------------------------------------------------------

    function resolveFlag(bytes32 flagId, FlagStatus newStatus) external onlyReviewPanel {
        require(flags[flagId].exists, "GovChain: flag not found");
        require(
            newStatus == FlagStatus.Resolved ||
            newStatus == FlagStatus.Disputed ||
            newStatus == FlagStatus.Confirmed,
            "GovChain: invalid resolution status"
        );

        DiscrepancyFlag storage flag = flags[flagId];
        flag.status = newStatus;

        emit FlagStatusChanged(flagId, newStatus, msg.sender, block.timestamp);

        // FR6: automatic reward the moment a flag is confirmed valid.
        if (newStatus == FlagStatus.Confirmed) {
            uint256 reward = 10; // pilot-fixed reward amount
            reputationBalance[flag.flaggedBy] += reward;
            emit ReputationTokenAwarded(flag.flaggedBy, reward, flagId);
        }
    }

    // ---------------------------------------------------------------
    // FR9 — Audit Log Export helpers (read-only enumeration, no permission gate,
    // satisfying NFR6's "independently queryable without the institution's permission")
    // ---------------------------------------------------------------

    function getRecordIdsCount() external view returns (uint256) {
        return recordIds.length;
    }

    function getRecordIdAt(uint256 index) external view returns (bytes32) {
        return recordIds[index];
    }

    function getFlagIdsCount() external view returns (uint256) {
        return flagIds.length;
    }

    function getFlagIdAt(uint256 index) external view returns (bytes32) {
        return flagIds[index];
    }
}