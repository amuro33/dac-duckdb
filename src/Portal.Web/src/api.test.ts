import { describe, it, expect } from "vitest";
import { csv, fmt } from "./api";
describe("CSV export", () => {
  it("escapes commas quotes and newlines", () => {
    expect(csv([{ name: 'a,"b"\nc' }])).toContain('"a,""b""\nc"');
  });
  it("neutralizes spreadsheet formulas", () => {
    const output = csv([
      { name: '=HYPERLINK("evil")' },
      { name: "+1" },
      { name: "@SUM(A1)" },
      { name: "-2" },
    ]);
    expect(output).toContain("'=HYPERLINK");
    expect(output).toContain("'+1");
    expect(output).toContain("'@SUM");
    expect(output).toContain("'-2");
  });
  it("preserves null and nonuniform schemas", () => {
    expect(csv([{ a: 1 }, { b: null }])).toBe(
      '\ufeff"a","b"\r\n"1",""\r\n"",""',
    );
  });
  it("includes UTF8 BOM for Korean Excel", () =>
    expect(csv([{ name: "검사" }]).charCodeAt(0)).toBe(0xfeff));
});
describe("metric display", () => {
  it("does not invent zero for unknown metrics", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(0)).toBe("0");
  });
});
