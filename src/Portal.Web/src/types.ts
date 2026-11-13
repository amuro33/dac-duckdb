export type Config = {
  source: string;
  category: string | null;
  legend: string | null;
  x: string;
  y: string;
  xType: string;
  pointSize?: number | null;
  showLabels?: boolean;
  labelColumn?: string | null;
  labelFontSize?: number;
  lotId: string | null;
  sampleSize: number | null;
};
export type Point = { x: string | number; y: number; label?: string };
export type Panel = {
  key: string;
  name: string;
  series: { key: string; name: string; points: Point[] }[];
};
export type Spec = {
  charts: Panel[];
  sourceRows: number;
  plottedRows: number;
  skippedRows: number;
  sampledOutRows: number;
  sampling: string;
  x: string;
  y: string;
  xType: string;
  pointSize?: number | null;
  showLabels?: boolean;
  labelColumn?: string | null;
  labelFontSize?: number;
};
export type View = {
  id: string;
  name: string;
  description: string;
  config: Config;
  pinned: boolean;
  version: number;
  updatedAt: string;
};
export type Run = {
  id: string;
  path: string;
  method: string;
  request: unknown;
  status: number;
  durationMs: number;
  rowCount: number | null;
  createdAt: string;
};
export type Column = { name: string; type: string; nullable: boolean };
export const initial: Config = {
  source: "eds",
  category: "lotId",
  legend: "product",
  x: "inspectedAt",
  y: "yieldPct",
  xType: "date",
  lotId: "LOT-101",
  sampleSize: null,
};
export const large: Config = {
  source: "eds",
  category: "lotId",
  legend: "product",
  x: "inspectedAt",
  y: "yieldPct",
  xType: "date",
  lotId: null,
  sampleSize: 1000000,
};
