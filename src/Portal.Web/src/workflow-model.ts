export type Kind = "query" | "join" | "merge" | "filter" | "output";
export type WNode = {
  id: string;
  kind: Kind;
  config: Record<string, any>;
  x: number;
  y: number;
};
export type WEdge = { source: string; target: string; port: string };
export type Definition = {
  nodes: WNode[];
  edges: WEdge[];
  inputs: Record<string, any>;
};
export type Workflow = {
  id: string;
  name: string;
  revision: number;
  published_version: number;
  definition: Definition;
};
export type Query = {
  query_id: string;
  query_version: number;
  name: string;
  database_name: string;
  default_body: Record<string, any>;
};
export const labels: Record<Kind, string> = {
  query: "Query",
  join: "Join",
  merge: "Merge",
  filter: "Filter",
  output: "Output",
};
export const ports = (kind: Kind) =>
  kind === "query"
    ? ["after"]
    : kind === "join" || kind === "merge"
      ? ["left", "right"]
      : ["input"];
export function example(queries: Query[]): Definition {
  const query = (id: string, queryId: string, y: number): WNode => {
    const q = queries.find((q) => q.query_id === queryId) || queries[0];
    return {
      id,
      kind: "query",
      x: 40,
      y,
      config: {
        queryId: q.query_id,
        queryVersion: q.query_version,
        body: { ...q.default_body, lot_id: { $input: "lot_id" }, limit: 100 },
      },
    };
  };
  return {
    inputs: { lot_id: "LOT-101" },
    nodes: [
      query("eds", "EDS_BY_LOT", 60),
      query("defects", "DEFECT_BY_LOT", 270),
      {
        id: "join",
        kind: "join",
        x: 340,
        y: 150,
        config: {
          joinType: "left",
          keys: [
            { left: "lot_id", right: "lot_id" },
            { left: "wafer_id", right: "wafer_id" },
          ],
        },
      },
      {
        id: "filter",
        kind: "filter",
        x: 640,
        y: 150,
        config: { rules: [{ column: "yield_pct", op: "gte", value: 95 }] },
      },
      { id: "output", kind: "output", x: 940, y: 150, config: {} },
    ],
    edges: [
      { source: "eds", target: "join", port: "left" },
      { source: "defects", target: "join", port: "right" },
      { source: "join", target: "filter", port: "input" },
      { source: "filter", target: "output", port: "input" },
    ],
  };
}
export function canConnect(
  d: Definition,
  source: string,
  target: string,
  port: string,
): boolean {
  const s = d.nodes.find((n) => n.id === source),
    t = d.nodes.find((n) => n.id === target);
  if (
    !s ||
    !t ||
    source === target ||
    s.kind === "output" ||
    !ports(t.kind).includes(port)
  )
    return false;
  const visit = (id: string, seen = new Set<string>()): boolean => {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return d.edges
      .filter((e) => e.source === id)
      .some((e) => visit(e.target, seen));
  };
  return !visit(target);
}
export function arrange(d: Definition): Definition {
  const levels: Record<string, number> = {};
  for (let pass = 0; pass < d.nodes.length; pass++)
    for (const n of d.nodes) {
      const parents = d.edges.filter((e) => e.target === n.id);
      if (parents.every((e) => levels[e.source] !== undefined))
        levels[n.id] =
          Math.max(-1, ...parents.map((e) => levels[e.source])) + 1;
    }
  const counts: Record<number, number> = {};
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      const level = levels[n.id] ?? 0;
      const row = counts[level] ?? 0;
      counts[level] = row + 1;
      return { ...n, x: 40 + level * 290, y: 60 + row * 180 };
    }),
  };
}

export function executionSignature(d: Definition): string {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return JSON.stringify(
    canonical({
      nodes: d.nodes
        .map(({ id, kind, config }) => ({ id, kind, config }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...d.edges].sort((a, b) =>
        (a.target + a.port).localeCompare(b.target + b.port),
      ),
      inputs: d.inputs,
    }),
  );
}
