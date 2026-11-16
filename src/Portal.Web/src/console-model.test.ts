import { describe, it, expect } from "vitest";
import { objectBody, bindingValue, responseRows } from "./console-model";
describe("console request bindings", () => {
  it("only accepts an object body", () => {
    for (const s of ["null", "[]", "1", "bad"])
      expect(() => objectBody(s)).toThrow();
    expect(objectBody('{"limit":10}')).toEqual({ limit: 10 });
  });
  it("preserves nullable and string values without accidental numeric conversion", () => {
    expect(bindingValue("null", "string", true)).toBeNull();
    expect(bindingValue("001", "string", false)).toBe("001");
    expect(bindingValue("null", "string", false)).toBe("null");
  });
  it("rejects empty, fractional integer and non-finite numeric bindings", () => {
    for (const v of ["", " ", "NaN", "Infinity", "1.2"])
      expect(() => bindingValue(v, "integer", false)).toThrow();
    expect(bindingValue("90.5", "number", false)).toBe(90.5);
  });
  it("does not treat errors or primitives as table rows", () => {
    expect(responseRows({ detail: "failed" })).toEqual([]);
    expect(responseRows([1, 2])).toEqual([]);
    expect(responseRows({ data: [{ x: 1 }] })).toEqual([{ x: 1 }]);
  });
});
