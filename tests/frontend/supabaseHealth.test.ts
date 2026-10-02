import { describe, expect, it, vi } from "vitest";
import { checkRecordingsTable } from "../../frontend/src/server/supabase";

const env = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};

describe("checkRecordingsTable", () => {
  it("reports unconfigured without calling the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      checkRecordingsTable({ SUPABASE_URL: " " }, fetchImpl),
    ).resolves.toEqual({ status: "unconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a row-free HEAD request with the secret key", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const times = [10, 42];
    const result = await checkRecordingsTable(
      env,
      fetchImpl,
      () => times.shift()!,
    );
    expect(result).toEqual({ status: "ok", latencyMs: 32 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://example.supabase.co/rest/v1/recordings?select=id&limit=1",
    );
    expect(init.method).toBe("HEAD");
    expect(init.headers).toEqual({ apikey: "sb_secret_test" });
  });

  it("returns only the status code when Supabase rejects the request", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("relation does not exist", { status: 404 }),
    );
    const result = await checkRecordingsTable(env, fetchImpl);
    expect(result).toEqual({ status: "error", httpStatus: 404 });
    expect(JSON.stringify(result)).not.toContain("sb_secret");
  });

  it("maps network failures to a detail-free error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED sb_secret_test");
    });
    await expect(checkRecordingsTable(env, fetchImpl)).resolves.toEqual({
      status: "error",
    });
  });
});
