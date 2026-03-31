/**
 * MongoBranch — Hook Manager
 *
 * 14 event types (validated from lakeFS).
 * Pre-hooks reject operations (sync, fail-fast).
 * Post-hooks are fire-and-forget (async, cannot reject).
 * Hooks execute in priority order (lowest first).
 */
import { randomUUID } from "crypto";
import type { MongoClient, Collection } from "mongodb";
import type {
  MongoBranchConfig,
  HookRegistration,
  HookEventType,
  HookContext,
  HookResult,
} from "./types.ts";
import { HOOKS_COLLECTION } from "./types.ts";

// In-memory handler registry (handlers are functions, not serializable)
type HookHandler = (context: HookContext) => Promise<HookResult>;
const handlerRegistry = new Map<string, HookHandler>();

export class HookManager {
  private hooks: Collection<HookRegistration>;

  constructor(client: MongoClient, config: MongoBranchConfig) {
    const metaDb = client.db(config.metaDatabase);
    this.hooks = metaDb.collection<HookRegistration>(HOOKS_COLLECTION);
  }

  async initialize(): Promise<void> {
    await this.hooks.createIndex({ event: 1, priority: 1 });
    await this.hooks.createIndex({ name: 1 }, { unique: true });
  }

  /**
   * Register a hook — stored in DB + handler in memory.
   */
  async registerHook(
    name: string,
    event: HookEventType,
    handler: HookHandler,
    options: { priority?: number; createdBy?: string } = {}
  ): Promise<HookRegistration> {
    const existing = await this.hooks.findOne({ name });
    if (existing) throw new Error(`Hook "${name}" already registered`);

    const handlerId = `hook_${randomUUID()}`;
    handlerRegistry.set(handlerId, handler);

    const registration: HookRegistration = {
      name,
      event,
      priority: options.priority ?? 100,
      handler: handlerId,
      isWebhook: false,
      createdBy: options.createdBy ?? "unknown",
      createdAt: new Date(),
    };

    await this.hooks.insertOne({ ...registration });
    return registration;
  }

  /**
   * Remove a hook by name.
   */
  async removeHook(name: string): Promise<boolean> {
    const hook = await this.hooks.findOne({ name });
    if (!hook) throw new Error(`Hook "${name}" not found`);

    handlerRegistry.delete(hook.handler);
    const result = await this.hooks.deleteOne({ name });
    return result.deletedCount > 0;
  }

  /**
   * List all registered hooks.
   */
  async listHooks(event?: HookEventType): Promise<HookRegistration[]> {
    const filter = event ? { event } : {};
    return this.hooks.find(filter).sort({ event: 1, priority: 1 }).toArray();
  }

  /**
   * Execute pre-hooks for an event. Fail-fast: first rejection stops.
   * Returns { allow, reason }.
   */
  async executePreHooks(context: HookContext): Promise<HookResult> {
    const hooks = await this.hooks
      .find({ event: context.event })
      .sort({ priority: 1 })
      .toArray();

    for (const hook of hooks) {
      const handler = handlerRegistry.get(hook.handler);
      if (!handler) continue;

      try {
        const result = await handler(context);
        if (!result.allow) {
          return {
            allow: false,
            reason: result.reason ?? `Rejected by hook "${hook.name}"`,
          };
        }
      } catch (err) {
        return {
          allow: false,
          reason: `Hook "${hook.name}" threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { allow: true };
  }

  /**
   * Execute post-hooks for an event. Fire-and-forget, cannot reject.
   * Errors are silently caught (post-hooks should never break flow).
   */
  async executePostHooks(context: HookContext): Promise<void> {
    const hooks = await this.hooks
      .find({ event: context.event })
      .sort({ priority: 1 })
      .toArray();

    for (const hook of hooks) {
      const handler = handlerRegistry.get(hook.handler);
      if (!handler) continue;

      try {
        await handler(context);
      } catch {
        // Post-hooks are fire-and-forget — swallow errors
      }
    }
  }

  /**
   * Create a HookContext with a unique runId.
   */
  static createContext(
    event: HookEventType,
    branchName: string,
    user: string = "unknown",
    extra: Partial<HookContext> = {}
  ): HookContext {
    return { event, branchName, user, runId: randomUUID(), ...extra };
  }
}
