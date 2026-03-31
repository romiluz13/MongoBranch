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
}

export type BranchStatus = "active" | "merged" | "deleted" | "creating" | "error";

export interface BranchCreateOptions {
  name: string;
  from?: string;
  description?: string;
  createdBy?: string;
  readOnly?: boolean;
  lazy?: boolean;
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
