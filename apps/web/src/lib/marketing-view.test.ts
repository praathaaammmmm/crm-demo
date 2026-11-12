import type { Content } from "@crm/contracts/marketing";
import { describe, expect, it } from "vitest";
import { contentMoveTargets, formatCount, groupByDate } from "./marketing-view";

const item = (id: string, plannedFor: string | null) => ({ id, plannedFor }) as Content;

describe("marketing view", () => {
  it("offers plain moves only; publishing has its own proof form", () => {
    expect(contentMoveTargets("in_review")).toEqual(["planned", "cancelled"]);
    expect(contentMoveTargets("draft")).toEqual(["planned", "cancelled"]);
    expect(contentMoveTargets("published")).toEqual([]);
  });

  it("groups the calendar by date with unscheduled content last", () => {
    const groups = groupByDate([item("a", "2026-11-14"), item("b", null), item("c", "2026-11-12"), item("d", "2026-11-14")]);
    expect(groups.map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ["2026-11-12", ["c"]],
      ["2026-11-14", ["a", "d"]],
      [null, ["b"]],
    ]);
  });

  it("formats counts in Indian grouping and shows a dash when nothing was recorded", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(1234567)).toBe("12,34,567");
  });
});
