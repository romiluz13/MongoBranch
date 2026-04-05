import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoClient } from "mongodb";
import { EnvironmentDoctor } from "../../src/core/doctor.ts";
import { startMongoDB, stopMongoDB } from "../setup.ts";
import type { MongoBranchConfig } from "../../src/core/types.ts";

describe("EnvironmentDoctor", () => {
  let client: MongoClient;
  let config: MongoBranchConfig;

  beforeAll(async () => {
    const env = await startMongoDB();
    client = env.client;
    config = {
      uri: env.uri,
      sourceDatabase: "doctor_source",
      metaDatabase: "__mongobranch_doctor",
      branchPrefix: "__mb_doc_",
    };
  }, 30_000);

  afterAll(async () => {
    await stopMongoDB();
  }, 10_000);

  it("returns a live capability report for the connected environment", async () => {
    const doctor = new EnvironmentDoctor(client, config);
    const report = await doctor.run({ timeoutMs: 20_000 });

    expect(report.summary.total).toBeGreaterThanOrEqual(6);
    expect(report.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "ping",
        "access_control_enforcement",
        "transactions",
        "database_change_streams",
        "pre_images",
        "search_index_round_trip",
        "vector_search_round_trip",
      ]),
    );

    const ping = report.checks.find((check) => check.name === "ping");
    const access = report.checks.find((check) => check.name === "access_control_enforcement");
    const txn = report.checks.find((check) => check.name === "transactions");
    const watch = report.checks.find((check) => check.name === "database_change_streams");
    const preImages = report.checks.find((check) => check.name === "pre_images");

    expect(ping?.status).toBe("pass");
    expect(access?.status).not.toBe("fail");
    expect(txn?.status).toBe("pass");
    expect(watch?.status).toBe("pass");
    expect(preImages?.status).not.toBe("fail");
  }, 45_000);
});
