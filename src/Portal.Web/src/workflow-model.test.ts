import { describe, it, expect } from "vitest";
import { example, canConnect, arrange, executionSignature } from "./workflow-model";
const q = [
  {
    query_id: "EDS_BY_LOT",
    query_version: 1,
    name: "EDS",
    database_name: "oracle",
    default_body: { database_name: "oracle", query_id: "EDS_BY_LOT" },
  },
];
describe("workflow graph", () => {
  it("rejects cycles and output connections", () => {
    const d = example(q);
    expect(canConnect(d, "filter", "eds", "after")).toBe(false);
    expect(canConnect(d, "output", "eds", "after")).toBe(false);
    expect(canConnect(d, "eds", "eds", "after")).toBe(false);
  });
  it("allows typed ports and API dependencies", () => {
    const d = example(q);
    expect(canConnect(d, "eds", "defects", "after")).toBe(true);
    expect(canConnect(d, "eds", "filter", "left")).toBe(false);
  });
  it("arranges dependencies before consumers", () => {
    const d = arrange(example(q));
    expect(d.nodes.find((n) => n.id === "join")!.x).toBeGreaterThan(
      d.nodes[0].x,
    );
    expect(d.nodes.find((n) => n.id === "output")!.x).toBeGreaterThan(
      d.nodes.find((n) => n.id === "filter")!.x,
    );
  });
  it("uses typed input references and preserves version", () => {
    const d = example(q);
    expect(d.nodes[0].config.body.lot_id).toEqual({ $input: "lot_id" });
    expect(d.nodes[0].config.queryVersion).toBe(1);
  });
});

it("execution signatures ignore layout and object property order but preserve logic", () => {
 const d=example(q), moved=arrange(d);expect(executionSignature(d)).toBe(executionSignature(moved));
 const changed=structuredClone(d);changed.nodes[0].config.queryVersion=2;expect(executionSignature(d)).not.toBe(executionSignature(changed));
});
