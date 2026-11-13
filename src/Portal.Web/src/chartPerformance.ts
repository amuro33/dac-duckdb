import type { Config, Point } from "./types";

export type RenderMeasure = {
  batchId: number;
  key: string;
  startedAt: number;
  finishedAt: number;
  readyAt: number;
  prepareMs: number;
  renderMs: number;
  points: number;
  mode: "large" | "normal";
  update: "data" | "appearance" | "resize";
  error?: string;
};
export type RenderBatch = {
  id: number;
  kind: "query" | "appearance" | "page" | "tab";
  actionStartedAt: number;
  renderStartedAt: number;
  receiveMs: number | null;
};
export function canReuseAppearance(a: Config, b: Config) {
  const key = (c: Config) =>
    JSON.stringify([
      c.source,
      c.category ?? null,
      c.legend ?? null,
      c.x,
      c.y,
      c.xType,
      c.lotId ?? null,
      c.sampleSize ?? null,
      c.showLabels ?? false,
      c.labelColumn ?? null,
    ]);
  return (
    key(a) === key(b) &&
    ((a.pointSize ?? null) !== (b.pointSize ?? null) ||
      (a.labelFontSize ?? 11) !== (b.labelFontSize ?? 11))
  );
}
export function summarizeRender(
  batch: RenderBatch,
  metrics: Record<string, RenderMeasure>,
  keys: string[],
) {
  const rows = keys
    .map((k) => metrics[k])
    .filter((m) => m?.batchId === batch.id);
  const complete = keys.length > 0 && rows.length === keys.length;
  const end = complete ? Math.max(...rows.map((m) => m.readyAt)) : null;
  return {
    complete,
    completed: rows.length,
    failed: rows.some((m) => !!m.error),
    renderMs: end == null ? null : Math.max(0, end - batch.renderStartedAt),
    totalMs: end == null ? null : Math.max(0, end - batch.actionStartedAt),
  };
}
export function duration(ms: number | null | undefined) {
  return ms == null
    ? "—"
    : ms >= 1000
      ? `${(ms / 1000).toFixed(2)}초`
      : `${ms.toFixed(1)} ms`;
}
// Float64 preserves millisecond timestamps. The cache is released with each dataset.
const packed = new WeakMap<Point[], Float64Array>();
export function packCoordinates(points: Point[]) {
  let data = packed.get(points);
  if (!data) {
    data = new Float64Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      if (typeof points[i].x !== "number")
        throw Error("Numeric chart requires numeric coordinates");
      data[i * 2] = points[i].x as number;
      data[i * 2 + 1] = points[i].y;
    }
    packed.set(points, data);
  }
  return data;
}
