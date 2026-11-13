import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareAnalysis } from "./engines";
import { data } from "./api";
import { canReuseAppearance } from "./chartPerformance";
import { initial, type Config } from "./types";
vi.mock("./api", () => ({ data: vi.fn() }));
const input: Config = {
  ...initial,
  source: "transformed",
  datasetId: "original",
  engine: "duckdb",
  datasetEngine: "duckdb",
};
beforeEach(() => vi.resetAllMocks());
describe("engine selection", () => {
  it("leaves raw API sources unchanged", async () => {
    expect(
      (await prepareAnalysis(initial, new AbortController().signal, vi.fn()))
        .config,
    ).toEqual(initial);
    expect(data).not.toHaveBeenCalled();
  });
  it("reuses an immutable result for the same engine", async () => {
    vi.mocked(data).mockResolvedValue({
      dataset: { config: { engine: "duckdb" } },
      result: [{ execution: { engine: "duckdb" } }],
    });
    const result = await prepareAnalysis(
      input,
      new AbortController().signal,
      vi.fn(),
    );
    expect(result.config.datasetId).toBe("original");
    expect(data).toHaveBeenCalledTimes(1);
  });
  it("compares engines using the same original snapshot", async () => {
    vi.mocked(data)
      .mockResolvedValueOnce({
        dataset: { config: { engine: "duckdb" } },
        result: [{}],
      })
      .mockResolvedValueOnce({ id: "spark-result" })
      .mockResolvedValueOnce({
        dataset: { status: "ready" },
        result: [{ execution: { engine: "spark" } }],
      });
    const result = await prepareAnalysis(
      { ...input, engine: "spark" },
      new AbortController().signal,
      vi.fn(),
    );
    expect(data).toHaveBeenNthCalledWith(
      2,
      "/api/streams/datasets/original/analyze",
      "POST",
      { engine: "spark" },
      true,
      expect.any(AbortSignal),
    );
    expect(result.config).toMatchObject({
      datasetId: "spark-result",
      engine: "spark",
      datasetEngine: "spark",
      source: "transformed",
    });
  });
  it("hydrates actual engine when a dataset deep link has no engine", async () => {
    vi.mocked(data).mockResolvedValue({
      dataset: { config: { engine: "drill" } },
      result: [{}],
    });
    expect(
      (
        await prepareAnalysis(
          { ...input, engine: undefined },
          new AbortController().signal,
          vi.fn(),
        )
      ).config.engine,
    ).toBe("drill");
    expect(data).toHaveBeenCalledTimes(1);
  });
  it("never hides a failed engine behind a fallback", async () => {
    vi.mocked(data)
      .mockResolvedValueOnce({
        dataset: { config: { engine: "duckdb" } },
        result: [{}],
      })
      .mockResolvedValueOnce({ id: "failed" })
      .mockResolvedValueOnce({
        dataset: { status: "failed" },
        result: [{ error: "Spark executor unavailable" }],
      });
    await expect(
      prepareAnalysis(
        { ...input, engine: "spark" },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow("Spark executor unavailable");
  });
  it("engine change invalidates appearance-only reuse", () => {
    expect(
      canReuseAppearance(input, { ...input, engine: "spark", pointSize: 8 }),
    ).toBe(false);
  });
});
