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
  uri: "mongodb://localhost:27018/?directConnection=true",
  sourceDatabase: "myapp",
  metaDatabase: "__mongobranch",
  branchPrefix: "__mb_",
};

export const MAIN_BRANCH = "main";
export const META_COLLECTION = "branches";
export const CHANGELOG_COLLECTION = "changelog";

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

export type ConflictStrategy = "ours" | "theirs" | "abort";

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

export const AGENTS_COLLECTION = "agents";
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
