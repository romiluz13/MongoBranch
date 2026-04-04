/**
 * MongoBranch — Webhook Stress Tests (Wave 9)
 *
 * HTTP POST webhook delivery for hook events.
 * Tests: pre-hook allow/reject, post-hook fire-and-forget, HMAC-SHA256,
 * timeout, concurrent delivery. Real HTTP server + real MongoDB, zero mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { MongoClient } from "mongodb";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import { HookManager } from "../../src/core/hooks.ts";
import type { MongoBranchConfig, HookContext } from "../../src/core/types.ts";

let client: MongoClient;
let config: MongoBranchConfig;
let hookManager: HookManager;
let server: Server;
let port: number;
let receivedRequests: Array<{ body: any; headers: Record<string, string | string[] | undefined> }>;

function startWebhookServer(handler?: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        receivedRequests.push({ body: parsed, headers: req.headers });

        if (handler) {
          handler(req, res);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ allow: true }));
        }
      });
    });
    server.listen(0, () => {
      const addr = server.address() as any;
      resolve(addr.port);
    });
  });
}

beforeAll(async () => {
  const env = await startMongoDB();
  client = env.client;
}, 30_000);

afterAll(async () => {
  await stopMongoDB();
}, 10_000);

beforeEach(async () => {
  config = {
    uri: "mongodb://localhost:27017",
    sourceDatabase: "test_webhook_source",
    metaDatabase: "__mongobranch_webhook",
    branchPrefix: "__mb_webhook_",
  };
  await client.db(config.metaDatabase).dropDatabase();
  hookManager = new HookManager(client, config);
  await hookManager.initialize();
  receivedRequests = [];
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("Webhook — Stress Tests", () => {
  it("pre-merge webhook receives correct payload and allows merge", async () => {
    port = await startWebhookServer();

    await hookManager.registerWebhook("allow-merge", "pre-merge", `http://localhost:${port}/hook`);

    const context = HookManager.createContext("pre-merge", "test-branch", "agent-1", {
      sourceBranch: "test-branch",
      targetBranch: "main",
    });

    const result = await hookManager.executePreHooks(context);
    expect(result.allow).toBe(true);

    // Verify webhook received the correct payload
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0]!.body.event).toBe("pre-merge");
    expect(receivedRequests[0]!.body.branchName).toBe("test-branch");
    expect(receivedRequests[0]!.body.sourceBranch).toBe("test-branch");
    expect(receivedRequests[0]!.headers["x-mongobranch-event"]).toBe("pre-merge");
    expect(receivedRequests[0]!.headers["x-mongobranch-hook"]).toBe("allow-merge");
  });

  it("pre-hook webhook rejects — blocks operation with reason", async () => {
    port = await startWebhookServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ allow: false, reason: "policy violation: no merges during freeze" }));
    });

    await hookManager.registerWebhook("reject-merge", "pre-merge", `http://localhost:${port}/hook`);

    const context = HookManager.createContext("pre-merge", "frozen-branch", "agent-x");
    const result = await hookManager.executePreHooks(context);

    expect(result.allow).toBe(false);
    expect(result.reason).toContain("policy violation");
  });

  it("post-commit webhook fires and forgets — operation succeeds regardless", async () => {
    let webhookCalled = false;
    port = await startWebhookServer((_req, res) => {
      webhookCalled = true;
      // Simulate slow webhook
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 100);
    });

    await hookManager.registerWebhook("post-notify", "post-commit", `http://localhost:${port}/hook`);

    const context = HookManager.createContext("post-commit", "commit-branch", "agent-y", {
      commitHash: "abc123def456",
    });

    // Post-hooks should complete without error
    await hookManager.executePostHooks(context);

    // Wait a bit for fire-and-forget to complete
    await new Promise(r => setTimeout(r, 300));
    expect(webhookCalled).toBe(true);
    expect(receivedRequests[0]!.body.commitHash).toBe("abc123def456");
  });

  it("HMAC-SHA256 signature is correct and verifiable", async () => {
    const secret = "my-super-secret-key-2026";
    port = await startWebhookServer();

    await hookManager.registerWebhook("signed-hook", "pre-merge", `http://localhost:${port}/hook`, {
      secret,
    });

    const context = HookManager.createContext("pre-merge", "signed-branch", "agent-z");
    await hookManager.executePreHooks(context);

    expect(receivedRequests.length).toBe(1);

    // Verify signature header exists
    const signature = receivedRequests[0]!.headers["x-mongobranch-signature"] as string;
    expect(signature).toBeTruthy();

    // Verify signature matches re-computed HMAC
    const payload = JSON.stringify(receivedRequests[0]!.body);
    const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
    expect(signature).toBe(expectedSig);
  });

  it("webhook timeout — pre-hook rejects on slow endpoint", async () => {
    port = await startWebhookServer((_req, res) => {
      // Simulate very slow response (2 seconds)
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ allow: true }));
      }, 2000);
    });

    await hookManager.registerWebhook("slow-hook", "pre-merge", `http://localhost:${port}/hook`, {
      timeout: 500, // 500ms timeout
    });

    const context = HookManager.createContext("pre-merge", "timeout-branch", "agent-slow");
    const result = await hookManager.executePreHooks(context);

    // Should reject because of timeout
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("timed out");
  });

  it("concurrent: 3 webhook calls fired simultaneously — all received", async () => {
    port = await startWebhookServer();

    await hookManager.registerWebhook("concurrent-hook", "post-commit", `http://localhost:${port}/hook`);

    // Fire 3 post-hooks concurrently
    const contexts = [
      HookManager.createContext("post-commit", "branch-1", "agent-1"),
      HookManager.createContext("post-commit", "branch-2", "agent-2"),
      HookManager.createContext("post-commit", "branch-3", "agent-3"),
    ];

    await Promise.all(contexts.map(ctx => hookManager.executePostHooks(ctx)));

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 500));

    // All 3 should have been received
    expect(receivedRequests.length).toBe(3);
    const branches = receivedRequests.map(r => r.body.branchName).sort();
    expect(branches).toEqual(["branch-1", "branch-2", "branch-3"]);
  });
});
