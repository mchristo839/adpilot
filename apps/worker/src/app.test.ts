import { beforeAll, describe, expect, it } from "vitest";

process.env.WORKER_API_KEY = "test-key";
process.env.DRY_RUN = "true";

describe("worker api auth", () => {
  let app: typeof import("./app.js").app;
  beforeAll(async () => {
    app = (await import("./app.js")).app;
  });
  it("rejects requests without the api key", async () => {
    const res = await app.request("/campaigns");
    expect(res.status).toBe(401);
  });
  it("rejects a wrong key", async () => {
    const res = await app.request("/kill", { method: "POST", headers: { "x-api-key": "nope" } });
    expect(res.status).toBe(401);
  });
});
