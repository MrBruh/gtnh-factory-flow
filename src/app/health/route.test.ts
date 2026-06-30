import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestDatasetVersionId } from "@/lib/server/dataset-query";
import pkg from "../../../package.json";
import { GET } from "./route";

vi.mock("@/lib/server/dataset-query", () => ({
  getLatestDatasetVersionId: vi.fn(async () => "gtnh-stable-2026-06-01"),
}));

describe("/health route", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_GIT_SHA;
    vi.mocked(getLatestDatasetVersionId).mockResolvedValue("gtnh-stable-2026-06-01");
  });

  it("returns ok with version, dataset version, and uptime", async () => {
    process.env.NEXT_PUBLIC_GIT_SHA = "abc1234";

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(pkg.version);
    expect(body.commit).toBe("abc1234");
    expect(body.datasetVersionId).toBe("gtnh-stable-2026-06-01");
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  it("stays green when no dataset manifest is present (proxy mode) and no SHA is set", async () => {
    vi.mocked(getLatestDatasetVersionId).mockResolvedValueOnce(null);

    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.datasetVersionId).toBeNull();
    expect(body.commit).toBeNull();
  });
});
