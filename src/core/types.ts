import type { ObjectId } from "mongodb";

export interface BranchMetadata {
  _id?: ObjectId;
  name: string;
  parentBranch: string | null;
  sourceDatabase: string;
  branchDatabase: string;
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  collections: string[];
  description?: string;
  readOnly?: boolean;
  lazy?: boolean;
  materializedCollections?: string[];
  headCommit?: string;  // SHA-256 hash of the latest commit on this branch
  expiresAt?: Date;     // TTL — branch auto-expires after this time
  parentDepth?: number; // Nesting depth: 0 = from main, 1 = from branch, 2 = from sub-branch
}

export type BranchStatus = "active" | "merged" | "deleted" | "creating" | "error";

export interface BranchCreateOptions {
  name: string;
  from?: string;
  description?: string;
  createdBy?: string;
  readOnly?: boolean;
  lazy?: boolean;
  ttlMinutes?: number;  // Branch auto-expires after N minutes
  maxDepth?: number;     // Max nesting depth (default 5). 0 = from main only
  collections?: string[];   // Only copy these collections (partial branch)
  schemaOnly?: boolean;     // Copy indexes + validators only, no data
}

export interface BranchListOptions {
  status?: BranchStatus;
  includeDeleted?: boolean;
}

export interface BranchSwitchResult {
  previousBranch: string | null;
  currentBranch: string;
  database: string;
}

export interface BranchDeleteResult {
  name: string;
  databaseDropped: boolean;
  collectionsRemoved: number;
}

export interface BranchRollbackResult {
  name: string;
  collectionsReset: number;
  documentsRestored: number;
}

export interface MongoBranchConfig {
  uri: string;
  sourceDatabase: string;
  metaDatabase: string;
  branchPrefix: string;
}

export const DEFAULT_CONFIG: MongoBranchConfig = {
  uri: "mongodb://localhost:27017/?directConnection=true",
  sourceDatabase: "myapp",
  metaDatabase: "__mongobranch",
  branchPrefix: "__mb_",
};

export const MAIN_BRANCH = "main";
export const META_COLLECTION = "branches";
export const CHANGELOG_COLLECTION = "changelog";

/**
 * Recommended MongoClient options for MongoBranch.
 * Applies retryable writes/reads, majority write concern, and appName.
 */
export const CLIENT_OPTIONS = {
  retryWrites: true,
  retryReads: true,
  w: "majority" as const,
  appName: "mongobranch",
};

// ── Diff Types ────────────────────────────────────────────────

export interface DiffResult {
  sourceBranch: string;
  targetBranch: string;
  totalChanges: number;
  collections: Record<string, CollectionDiff>;
  indexChanges?: Record<string, IndexDiff>;
  validationChanges?: Record<string, ValidationDiff>;
}

export interface IndexDiff {
  added: IndexInfo[];
  removed: IndexInfo[];
}

export interface IndexInfo {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
}

export interface ValidationDiff {
  source: ValidationRule | null;
  target: ValidationRule | null;
  changed: boolean;
}

export interface ValidationRule {
  validator?: Record<string, unknown>;
  validationLevel?: string;
  validationAction?: string;
}

export interface CollectionDiff {
  added: DocumentChange[];
  removed: DocumentChange[];
  modified: ModifiedDocument[];
}

export interface DocumentChange {
  _id: unknown;
  [key: string]: unknown;
}

export interface ModifiedDocument {
  _id: unknown;
  fields: Record<string, { from: unknown; to: unknown }> | null;
}

// ── Merge Types ───────────────────────────────────────────────

export interface MergeResult {
  sourceBranch: string;
  targetBranch: string;
  collectionsAffected: number;
  documentsAdded: number;
  documentsRemoved: number;
  documentsModified: number;
  conflicts: MergeConflict[];
  success: boolean;
  dryRun?: boolean;
}

export interface MergeOptions {
  dryRun?: boolean;
  detectConflicts?: boolean;
  conflictStrategy?: ConflictStrategy;
}

export type ConflictStrategy = "ours" | "theirs" | "abort" | "manual";

export interface MergeConflict {
  collection: string;
  documentId: unknown;
  reason: string;
}

// ── Three-Way Merge Types ────────────────────────────────────

export interface ThreeWayMergeResult {
  sourceBranch: string;
  targetBranch: string;
  mergeBase: string | null;           // Commit hash of common ancestor
  collectionsAffected: number;
  documentsAdded: number;
  documentsRemoved: number;
  documentsModified: number;
  conflicts: ThreeWayConflict[];
  mergeCommitHash?: string;
  success: boolean;
  dryRun?: boolean;
}

export interface ThreeWayConflict {
  collection: string;
  documentId: unknown;
  field: string;
  base: unknown;                      // Value in common ancestor
  ours: unknown;                      // Value in target (merge-into) branch
  theirs: unknown;                    // Value in source (merge-from) branch
  resolved?: boolean;
  resolvedValue?: unknown;
}

export interface ThreeWayMergeOptions {
  dryRun?: boolean;
  conflictStrategy?: ConflictStrategy;
  author?: string;
  message?: string;
}

// ── Branch Protection Types ──────────────────────────────────

export const PROTECTIONS_COLLECTION = "protections";

export interface BranchProtection {
  _id?: ObjectId;
  pattern: string;     // Branch name or glob pattern (e.g., "main", "prod-*")
  requireMergeOnly: boolean;  // Prevent direct writes, only merges allowed
  preventDelete: boolean;
  createdBy: string;
  createdAt: Date;
}

// ── Hook Types ──────────────────────────────────────────────

export const HOOKS_COLLECTION = "hooks";

export type HookEventType =
  | "pre-commit" | "post-commit"
  | "pre-merge" | "post-merge"
  | "pre-create-branch" | "post-create-branch"
  | "pre-delete-branch" | "post-delete-branch"
  | "pre-create-tag" | "post-create-tag"
  | "pre-delete-tag" | "post-delete-tag"
  | "pre-revert" | "pre-cherry-pick";

export interface HookRegistration {
  _id?: ObjectId;
  name: string;
  event: HookEventType;
  priority: number;
  handler: string;  // Serialized handler ID or webhook URL
  isWebhook: boolean;
  webhookSecret?: string;  // HMAC-SHA256 signing secret
  webhookTimeout?: number; // Timeout in ms (default 5000)
  webhookRetries?: number; // Number of retries (default 1)
  createdBy: string;
  createdAt: Date;
}

export interface HookContext {
  event: HookEventType;
  branchName: string;
  user: string;
  runId: string;
  commitHash?: string;
  tagName?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface HookResult {
  allow: boolean;
  reason?: string;
}

// ── Cherry-Pick & Revert Types ───────────────────────────────

export interface CherryPickResult {
  sourceCommitHash: string;
  targetBranch: string;
  newCommitHash: string;
  documentsAdded: number;
  documentsRemoved: number;
  documentsModified: number;
  success: boolean;
}

export interface RevertResult {
  revertedCommitHash: string;
  branchName: string;
  newCommitHash: string;
  documentsReverted: number;
  success: boolean;
}

// ── Agent Types ──────────────────────────────────────────────

export interface AgentMetadata {
  _id?: ObjectId;
  agentId: string;
  name?: string;
  description?: string;
  status: AgentStatus;
  registeredAt: Date;
  lastActiveAt: Date;
}

export type AgentStatus = "active" | "inactive" | "suspended";

export interface AgentRegisterOptions {
  agentId: string;
  name?: string;
  description?: string;
}

export interface AgentBranchOptions {
  task: string;
  description?: string;
}

export interface AgentStatusResult {
  agentId: string;
  name?: string;
  status: AgentStatus;
  activeBranches: number;
  registeredAt: Date;
  lastActiveAt: Date;
}

// ── Agent Scope Types ────────────────────────────────────────

export type ScopePermission = "read" | "write" | "delete" | "merge";

export interface AgentScope {
  agentId: string;
  allowedCollections?: string[];      // null = all collections
  deniedCollections?: string[];       // explicit deny (overrides allow)
  permissions: ScopePermission[];     // what ops the agent can perform
  maxBranches?: number;               // max simultaneous branches
  maxDocumentsPerWrite?: number;      // per-op doc limit
  createdAt: Date;
  updatedAt: Date;
}

export interface ScopeViolation {
  agentId: string;
  branchName: string;
  collection: string;
  operation: string;
  reason: string;
  timestamp: Date;
}

export const AGENTS_COLLECTION = "agents";
export const AGENT_SCOPES_COLLECTION = "agent_scopes";
export const SCOPE_VIOLATIONS_COLLECTION = "scope_violations";
export const SNAPSHOTS_COLLECTION = "snapshots";
export const MERGE_QUEUE_COLLECTION = "merge_queue";

// ── Merge Queue Types ───────────────────────────────────────

export type MergeQueueStatus = "pending" | "processing" | "completed" | "failed";

export interface MergeQueueEntry {
  _id?: ObjectId;
  branchName: string;
  targetBranch: string;
  status: MergeQueueStatus;
  queuedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  queuedBy?: string;
  result?: MergeResult;
  error?: string;
}

// ── Snapshot / History Types ────────────────────────────────

export type SnapshotEvent = "branch_created" | "branch_merged" | "branch_deleted" | "data_modified";

export interface Snapshot {
  _id?: ObjectId;
  branchName: string;
  event: SnapshotEvent;
  timestamp: Date;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface BranchLog {
  branchName: string;
  entries: Snapshot[];
}

// ── Commit Types ─────────────────────────────────────────

export const COMMITS_COLLECTION = "commits";
export const TAGS_COLLECTION = "tags";

export interface Tag {
  _id?: ObjectId;
  name: string;
  commitHash: string;
  message?: string;
  createdBy: string;
  createdAt: Date;
}

export interface Commit {
  _id?: ObjectId;
  hash: string;
  branchName: string;
  parentHashes: string[];   // Single parent for normal commits, two for merge commits
  message: string;
  author: string;
  timestamp: Date;
  snapshot: CommitSnapshot;
}

export interface CommitSnapshot {
  collections: Record<string, CollectionSnapshot>;
}

export interface CollectionSnapshot {
  documentCount: number;
  checksum: string;   // SHA-256 of sorted document IDs for fast comparison
}

export interface CommitOptions {
  branchName: string;
  message: string;
  author?: string;
  parentOverrides?: string[];  // For merge commits with two parents
}

export interface CommitLog {
  branchName: string;
  commits: Commit[];
}

// ── Time Travel Types ─────────────────────────────────────

export const COMMIT_DATA_COLLECTION = "commit_data";

export interface CommitData {
  _id?: ObjectId;
  commitHash: string;
  collection: string;
  documents: Record<string, unknown>[];
  documentCount: number;
  storedAt: Date;
}

export interface TimeTravelQuery {
  branchName: string;
  collection: string;
  filter?: Record<string, unknown>;
  at: string;  // commitHash or ISO timestamp
}

export interface TimeTravelResult {
  branchName: string;
  collection: string;
  commitHash: string;
  commitMessage: string;
  commitTimestamp: Date;
  documents: Record<string, unknown>[];
  documentCount: number;
}

// ── Blame Types ───────────────────────────────────────────

export interface BlameEntry {
  field: string;
  value: unknown;
  commitHash: string;
  author: string;
  timestamp: Date;
  message: string;
}

export interface BlameResult {
  branchName: string;
  collection: string;
  documentId: string;
  fields: Record<string, BlameEntry[]>;
  totalCommitsScanned: number;
}

// ── Deploy Request Types ──────────────────────────────────

export const DEPLOY_REQUESTS_COLLECTION = "deploy_requests";

export type DeployRequestStatus = "open" | "approved" | "rejected" | "merged";

export interface DeployRequest {
  _id?: ObjectId;
  id: string;  // Short unique ID
  sourceBranch: string;
  targetBranch: string;
  description: string;
  status: DeployRequestStatus;
  diff?: Record<string, unknown>;
  createdBy: string;
  reviewedBy?: string;
  rejectionReason?: string;
  mergedAt?: Date;
  isTargetProtected?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Operation Log Types ───────────────────────────────────

export const OPLOG_COLLECTION = "oplog";

export type OpType = "insert" | "update" | "delete";

export interface OperationEntry {
  _id?: ObjectId;
  branchName: string;
  collection: string;
  operation: OpType;
  documentId: string;
  timestamp: Date;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  performedBy?: string;
}

// ── Search Index Types ───────────────────────────────────

export type SearchIndexType = "search" | "vectorSearch";

export interface SearchIndexDefinition {
  name: string;
  type: SearchIndexType;
  collectionName: string;
  definition: Record<string, unknown>;  // Analyzer mappings or vector fields
  status?: string;                       // READY, BUILDING, etc.
  queryable?: boolean;
}

export interface SearchIndexDiff {
  collection: string;
  added: SearchIndexDefinition[];        // In source but not target
  removed: SearchIndexDefinition[];      // In target but not source
  modified: SearchIndexModification[];   // Same name, different definition
  unchanged: string[];                   // Same name, same definition
}

export interface SearchIndexModification {
  name: string;
  type: SearchIndexType;
  collection: string;
  source: Record<string, unknown>;       // Definition in source
  target: Record<string, unknown>;       // Definition in target
}

export interface SearchIndexCopyResult {
  sourceBranch: string;
  targetBranch: string;
  indexesCopied: number;
  indexesFailed: number;
  details: { collection: string; indexName: string; status: "copied" | "failed"; error?: string }[];
}

export interface SearchIndexMergeResult {
  sourceBranch: string;
  targetBranch: string;
  indexesCreated: number;
  indexesUpdated: number;
  indexesRemoved: number;
  errors: { collection: string; indexName: string; error: string }[];
  success: boolean;
}

// ── Audit Chain Types (Wave 9 — EU AI Act Compliance) ────

export const AUDIT_CHAIN_COLLECTION = "audit_chain";

export type AuditEntryType =
  | "oplog"
  | "reflog"
  | "branch"
  | "merge"
  | "deploy"
  | "commit"
  | "checkpoint"
  | "genesis";

export interface AuditChainEntry {
  _id?: ObjectId;
  entryId: string;        // nanoid
  sequence: number;        // monotonic counter
  entryType: AuditEntryType;
  branchName: string;
  actor: string;
  action: string;
  detail: string;
  dataHash: string;        // SHA-256 of the detail payload
  prevHash: string;        // chainHash of the previous entry (or "GENESIS")
  chainHash: string;       // SHA-256(prevHash + dataHash + sequence)
  timestamp: Date;
}

export interface AuditChainVerification {
  valid: boolean;
  totalEntries: number;
  brokenAt?: number;       // sequence number where chain breaks
  brokenReason?: string;
  firstEntry?: AuditChainEntry;
  lastEntry?: AuditChainEntry;
}

// ── Checkpoint Types (Wave 9 — Lightweight Save Points) ──

export const CHECKPOINTS_COLLECTION = "checkpoints";

export interface CheckpointEntry {
  _id?: ObjectId;
  id: string;              // short nanoid
  branchName: string;
  commitHash: string;      // auto-created commit
  createdBy: string;
  createdAt: Date;
  expiresAt?: Date;
  label?: string;
  auto: boolean;
}

export interface CheckpointResult {
  id: string;
  branchName: string;
  commitHash: string;
  collectionsSnapshotted: number;
  documentCount: number;
}

export interface RestoreResult {
  branchName: string;
  checkpointId: string;
  collectionsRestored: number;
  documentsRestored: number;
  commitsRolledBack: number;
}

// ── Execution Guard Types (Wave 9 — Idempotent Agent Ops) ─

export const EXECUTION_RECEIPTS_COLLECTION = "execution_receipts";

export interface ExecutionReceipt {
  _id?: ObjectId;
  requestId: string;
  toolName: string;
  branchName: string;
  argsHash: string;        // SHA-256 of serialized args
  result: string;          // JSON-serialized tool result
  executedAt: Date;
  expiresAt: Date;
}


/**
 * Sanitize a branch name for use as a MongoDB database name.
 *
 * Per the official MongoDB documentation (mongodb.com/docs/manual/reference/limits/):
 *   - Unix/Linux: database names cannot contain  /\. "$
 *   - Windows:    database names cannot contain  /\. "$*<>:|?
 *   - All:        cannot contain null, must be < 64 bytes, cannot be empty
 *
 * Branch names are validated to allow [a-zA-Z0-9._\-\/] (see BRANCH_NAME_REGEX in branch.ts).
 * This function replaces the two invalid characters that can appear in valid branch names:
 *   - / (forward slash) → -- (double dash)
 *   - . (dot)           → -dot- (dash-dot-dash)
 *
 * All other invalid characters (\, ", $, *, <, >, :, |, ?) are rejected by the
 * branch name validator and never reach this function.
 */
export function sanitizeBranchDbName(branchName: string): string {
  return branchName
    .replace(/\//g, "--")
    .replace(/\./g, "-dot-");
}
