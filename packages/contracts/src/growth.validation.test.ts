import { describe, expect, it } from "vitest";
import {
  createCompanyRequestSchema,
  createContactRequestSchema,
  hasContactMethod,
  normalizeName,
  updateCompanyRequestSchema,
} from "./growth.js";

describe("growth validation", () => {
  it("normalises names so spacing and case cannot bypass duplicate or length rules", () => {
    expect(normalizeName("  Acme   Inc  ")).toBe("Acme Inc");
    expect(createCompanyRequestSchema.parse({ name: " Acme \t Inc " }).name).toBe("Acme Inc");
    expect(createCompanyRequestSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createCompanyRequestSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(createCompanyRequestSchema.safeParse({ name: `  ${"x".repeat(200)}  ` }).success).toBe(true);
  });

  it("trims industry to at most 100 characters and stores blank as null", () => {
    expect(createCompanyRequestSchema.parse({ name: "A", industry: "  Fintech  " }).industry).toBe("Fintech");
    expect(createCompanyRequestSchema.parse({ name: "A", industry: "   " }).industry).toBeNull();
    expect(createCompanyRequestSchema.safeParse({ name: "A", industry: "x".repeat(101) }).success).toBe(false);
    expect(createCompanyRequestSchema.safeParse({ name: "A", industry: ` ${"x".repeat(100)} ` }).success).toBe(true);
  });

  it("accepts only https websites", () => {
    expect(createCompanyRequestSchema.safeParse({ name: "A", websiteUrl: "http://acme.test" }).success).toBe(false);
    expect(createCompanyRequestSchema.parse({ name: "A", websiteUrl: "https://acme.test" }).websiteUrl).toBe("https://acme.test");
    expect(updateCompanyRequestSchema.safeParse({}).success).toBe(false);
  });

  it("requires a contact name and at least one contact method", () => {
    expect(createContactRequestSchema.safeParse({ fullName: "Asha Rao" }).success).toBe(false);
    expect(createContactRequestSchema.safeParse({ fullName: "Asha Rao", email: "  " }).success).toBe(false);
    expect(createContactRequestSchema.safeParse({ fullName: "  ", email: "asha@example.test" }).success).toBe(false);
    for (const method of [
      { email: "ASHA@Example.test" },
      { phone: "+91 98765 43210" },
      { linkedinUrl: "https://www.linkedin.com/in/asha" },
      { websiteUrl: "https://asha.example.test" },
    ]) {
      expect(createContactRequestSchema.safeParse({ fullName: "Asha Rao", ...method }).success).toBe(true);
    }
    expect(createContactRequestSchema.parse({ fullName: "Asha", email: " ASHA@Example.test " }).email).toBe("asha@example.test");
    expect(hasContactMethod({ email: null, phone: null })).toBe(false);
  });

  it("rejects bad phones and non-LinkedIn profile links", () => {
    expect(createContactRequestSchema.safeParse({ fullName: "A", phone: "call me" }).success).toBe(false);
    expect(createContactRequestSchema.safeParse({ fullName: "A", linkedinUrl: "https://example.test/in/a" }).success).toBe(false);
    expect(createContactRequestSchema.safeParse({ fullName: "A", linkedinUrl: "http://linkedin.com/in/a" }).success).toBe(false);
  });
});
