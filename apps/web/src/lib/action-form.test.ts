import { describe, expect, it } from "vitest";
import { buildBody, createdId, type FieldSpec } from "./action-form";

const fields: FieldSpec[] = [
  { name: "title", label: "Title", kind: "text", required: true },
  { name: "brief", label: "Brief", kind: "textarea", empty: "null" },
  { name: "plannedFor", label: "Planned for", kind: "date" },
  { name: "reach", label: "Reach", kind: "number" },
  { name: "proofUrl", label: "Proof link", kind: "url" },
  { name: "done", label: "Done", kind: "checkbox" },
];
const reader = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe("action form body", () => {
  it("trims, omits or nulls empty values, converts numbers and checkboxes, and adds fixed fields", () => {
    expect(buildBody(fields, reader({ title: "  Post  ", brief: " ", reach: "12", done: "on" }), { to: "published" })).toEqual({
      ok: true,
      body: { to: "published", title: "Post", brief: null, reach: 12, done: true },
    });
  });

  it("refuses missing required fields, non-numbers and non-https links with a safe message", () => {
    expect(buildBody(fields, reader({}))).toEqual({ ok: false, message: "Fill in title." });
    expect(buildBody(fields, reader({ title: "x", reach: "-3" }))).toEqual({ ok: false, message: "Reach must be a whole number." });
    expect(buildBody(fields, reader({ title: "x", proofUrl: "http://a" }))).toEqual({ ok: false, message: "Proof link must start with https://" });
  });

  it("converts local date-times to ISO-8601", () => {
    const result = buildBody([{ name: "at", label: "At", kind: "datetime" }], reader({ at: "2026-11-12T10:30" }));
    expect(result.ok && typeof result.body["at"] === "string" && result.body["at"].endsWith("Z")).toBe(true);
  });

  it("finds the created id for redirects", () => {
    expect(createdId({ campaign: { id: "abc" } }, "campaign")).toBe("abc");
    expect(createdId({ campaign: null }, "campaign")).toBeNull();
    expect(createdId("x", "campaign")).toBeNull();
  });
});
