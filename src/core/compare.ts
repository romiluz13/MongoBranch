/**
 * MongoBranch — Branch Comparison Matrix
 *
 * N-way branch comparison: compare 2+ branches side by side.
 * Returns per-document presence matrix and overlap statistics.
 */
import type { MongoClient } from "mongodb";
import { type MongoBranchConfig, sanitizeBranchDbName } from "./types.ts";

export interface CompareEntry {
  collection: string;
  documentId: string;
  branches: Record<string, "present" | "modified" | "absent">;
}

export interface CompareResult {
  branches: string[];
  collections: string[];
  entries: CompareEntry[];
  stats: {
    totalDocuments: number;
    inAllBranches: number;
    inSomeBranches: number;
    uniqueToOneBranch: number;
  };
}

export class BranchComparator {
  private client: MongoClient;
  private config: MongoBranchConfig;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Compare N branches side by side.
   * Returns per-document presence/status across all branches.
   */
  async compare(branchNames: string[]): Promise<CompareResult> {
    if (branchNames.length < 2) {
      throw new Error("Need at least 2 branches to compare");
    }

    // Verify branches exist
    const meta = this.client.db(this.config.metaDatabase);
    for (const name of branchNames) {
      const branch = await meta.collection("branches").findOne({
        name,
        status: { $ne: "deleted" },
      });
      if (!branch) throw new Error(`Branch "${name}" not found`);
    }

    // Collect all documents from all branches
    const branchDocs: Map<string, Map<string, Map<string, Record<string, unknown>>>> = new Map();
    // branchName → collection → docId → document
    const allCollections = new Set<string>();

    for (const branchName of branchNames) {
      const branchDbName = `${this.config.branchPrefix}${sanitizeBranchDbName(branchName)}`;
      const branchDb = this.client.db(branchDbName);
      const collections = await branchDb.listCollections().toArray();
      const branchMap: Map<string, Map<string, Record<string, unknown>>> = new Map();

      for (const col of collections) {
        if (col.name.startsWith("system.")) continue;
        allCollections.add(col.name);
        const docs = await branchDb.collection(col.name).find({}).toArray();
        const docMap = new Map<string, Record<string, unknown>>();
        for (const doc of docs) {
          docMap.set(String(doc._id), doc as Record<string, unknown>);
        }
        branchMap.set(col.name, docMap);
      }

      branchDocs.set(branchName, branchMap);
    }

    // Build comparison entries
    const entries: CompareEntry[] = [];
    const allDocIds = new Map<string, Set<string>>(); // collection → Set<docId>

    for (const col of allCollections) {
      const docIds = new Set<string>();
      for (const branchName of branchNames) {
        const colDocs = branchDocs.get(branchName)?.get(col);
        if (colDocs) {
          for (const id of colDocs.keys()) docIds.add(id);
        }
      }
      allDocIds.set(col, docIds);
    }

    // Use first branch as reference for "modified" detection
    const refBranch = branchNames[0];

    for (const [col, docIds] of allDocIds) {
      for (const docId of docIds) {
        const branches: Record<string, "present" | "modified" | "absent"> = {};
        const refDoc = branchDocs.get(refBranch!)?.get(col)?.get(docId);

        for (const branchName of branchNames) {
          const doc = branchDocs.get(branchName)?.get(col)?.get(docId);
          if (!doc) {
            branches[branchName] = "absent";
          } else if (branchName === refBranch || !refDoc) {
            branches[branchName] = "present";
          } else {
            // Compare to reference branch
            const same = JSON.stringify(doc) === JSON.stringify(refDoc);
            branches[branchName] = same ? "present" : "modified";
          }
        }

        entries.push({ collection: col, documentId: docId, branches });
      }
    }

    // Compute stats
    let inAll = 0, inSome = 0, unique = 0;
    for (const entry of entries) {
      const presentCount = Object.values(entry.branches).filter(v => v !== "absent").length;
      if (presentCount === branchNames.length) inAll++;
      else if (presentCount === 1) unique++;
      else inSome++;
    }

    return {
      branches: branchNames,
      collections: [...allCollections],
      entries,
      stats: {
        totalDocuments: entries.length,
        inAllBranches: inAll,
        inSomeBranches: inSome,
        uniqueToOneBranch: unique,
      },
    };
  }
}
