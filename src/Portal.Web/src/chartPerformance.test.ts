import { describe, it, expect } from "vitest";
import {
  canReuseAppearance,
  packCoordinates,
  summarizeRender,
  type RenderBatch,
  type RenderMeasure,
} from "./chartPerformance";
import { initial } from "./types";
describe("appearance reuse boundary", () => {
  it("reuses only changed styling; explicit rerun still queries", () => {
    expect(canReuseAppearance(initial, { ...initial, pointSize: 7 })).toBe(
      true,
    );
    expect(canReuseAppearance(initial, { ...initial, labelFontSize: 14 })).toBe(
      true,
    );
    expect(canReuseAppearance(initial, { ...initial })).toBe(false);
  });
  it.each([
    "source",
    "category",
    "legend",
    "x",
    "y",
    "xType",
    "lotId",
    "sampleSize",
    "showLabels",
    "labelColumn",
  ] as const)("requires new data when %s changes", (key) => {
    expect(
      canReuseAppearance(initial, {
        ...initial,
        pointSize: 7,
        [key]:
          key === "sampleSize"
            ? 1000
            : key === "showLabels"
              ? true
              : "different",
      }),
    ).toBe(false);
  });
});
describe("render timing", () => {
  const batch: RenderBatch = {
    id: 2,
    kind: "query",
    actionStartedAt: 100,
    renderStartedAt: 200,
    receiveMs: 100,
  };
  const metric = (
    key: string,
    readyAt: number,
    batchId = 2,
  ): RenderMeasure => ({
    key,
    batchId,
    readyAt,
    startedAt: 200,
    finishedAt: readyAt - 10,
    renderMs: readyAt - 210,
    prepareMs: 1,
    points: 10,
    mode: "large",
    update: "data",
  });
  it("uses wall time of last visible chart, not sum of overlapping work", () => {
    expect(
      summarizeRender(
        batch,
        {
          a: metric("a", 300),
          b: metric("b", 400),
          offscreen: metric("offscreen", 900),
        },
        ["a", "b"],
      ),
    ).toMatchObject({ complete: true, renderMs: 200, totalMs: 300 });
  });
  it("ignores previous batches and never reports incomplete work as finished", () => {
    expect(
      summarizeRender(batch, { a: metric("a", 300), b: metric("b", 400, 1) }, [
        "a",
        "b",
      ]),
    ).toMatchObject({ complete: false, completed: 1, renderMs: null });
    expect(summarizeRender(batch, {}, []).complete).toBe(false);
  });
  it("surfaces failed charts", () =>
    expect(
      summarizeRender(batch, { a: { ...metric("a", 300), error: "failure" } }, [
        "a",
      ]).failed,
    ).toBe(true));
});
describe("packed full data", () => {
  it("preserves all one million points, subsecond dates and double precision Y", () => {
    const points = Array.from({ length: 1000000 }, (_, i) => ({
      x: 1794000000000 + i,
      y: 90.123456789 + i / 1e6,
    }));
    const packed = packCoordinates(points);
    expect(packed.length).toBe(2000000);
    for (let i = 0; i < points.length; i++)
      if (packed[i * 2] !== points[i].x || packed[i * 2 + 1] !== points[i].y)
        throw Error("Coordinate loss at " + i);
    expect(packCoordinates(points)).toBe(packed);
  });
  it("rejects string X rather than silently losing it", () =>
    expect(() => packCoordinates([{ x: "wafer", y: 1 }])).toThrow());
});

it("does not reuse styling across different transformed datasets", () => {
  expect(
    canReuseAppearance(
      { ...initial, source: "transformed", datasetId: "dataset-one" },
      {
        ...initial,
        source: "transformed",
        datasetId: "dataset-two",
        pointSize: 7,
      },
    ),
  ).toBe(false);
});
