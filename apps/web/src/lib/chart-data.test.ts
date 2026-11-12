import { describe, expect, it } from "vitest";
import { countBy, distributionRows, percentOf, plural, totalOf } from "./chart-data";

const ORDER = ["todo", "doing", "done"] as const;

describe("countBy", () => {
  it("counts in the fixed order and keeps empty categories", () => {
    const rows = countBy([{ s: "done" }, { s: "todo" }, { s: "done" }], (item) => item.s as (typeof ORDER)[number], ORDER);
    expect(rows).toEqual([
      { key: "todo", count: 1 },
      { key: "doing", count: 0 },
      { key: "done", count: 2 },
    ]);
  });
});

describe("percentOf", () => {
  it("rounds to a whole percent and refuses to divide by zero", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBeNull();
  });
});

describe("distributionRows", () => {
  const rows = [
    { key: "todo", count: 1 },
    { key: "doing", count: 0 },
    { key: "done", count: 3 },
  ] as const;

  it("prints count and share for every row", () => {
    expect(distributionRows(rows, (key) => key.toUpperCase()).map((row) => row.text)).toEqual(["1 · 25%", "0 · 0%", "3 · 75%"]);
  });

  it("can drop empty categories", () => {
    expect(distributionRows(rows, (key) => key, { hideZero: true }).map((row) => row.key)).toEqual(["todo", "done"]);
  });

  it("prints a bare count when the total is zero", () => {
    expect(distributionRows([{ key: "todo", count: 0 }], (key) => key)[0]?.text).toBe("0");
  });

  it("totals counts", () => {
    expect(totalOf(rows)).toBe(4);
  });
});

describe("plural", () => {
  it("uses the singular only for exactly one", () => {
    expect(plural(1, "automation", "automations")).toBe("1 automation");
    expect(plural(2, "automation", "automations")).toBe("2 automations");
    expect(plural(0, "automation", "automations")).toBe("0 automations");
  });
});
