/** Declarative fields for small record forms. Pure, so the request body rules can be unit-tested. */

export type FieldKind = "text" | "textarea" | "date" | "datetime" | "url" | "number" | "select" | "checkbox";

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** What an empty optional input sends: nothing (default) or null, which clears a stored value. */
  empty?: "omit" | "null";
  options?: { value: string; label: string }[];
  defaultValue?: string;
  maxLength?: number;
  hint?: string;
}

export type BodyValue = string | number | boolean | null;

/**
 * Turns raw form values into a JSON body: trims text, converts numbers, checkboxes and local date-times
 * (to ISO-8601), and applies the empty-value rule. Returns a safe message for the first invalid field.
 */
export function buildBody(
  fields: readonly FieldSpec[],
  read: (name: string) => string | null,
  fixed: Record<string, BodyValue> = {},
): { ok: true; body: Record<string, BodyValue> } | { ok: false; message: string } {
  const body: Record<string, BodyValue> = { ...fixed };
  for (const field of fields) {
    const raw = read(field.name);
    if (field.kind === "checkbox") {
      body[field.name] = raw !== null;
      continue;
    }
    const value = (raw ?? "").trim();
    if (value.length === 0) {
      if (field.required) return { ok: false, message: `Fill in ${field.label.toLowerCase()}.` };
      if (field.empty === "null") body[field.name] = null;
      continue;
    }
    if (field.kind === "number") {
      if (!/^\d{1,10}$/.test(value)) return { ok: false, message: `${field.label} must be a whole number.` };
      body[field.name] = Number(value);
    } else if (field.kind === "datetime") {
      const time = new Date(value);
      if (Number.isNaN(time.getTime())) return { ok: false, message: `${field.label} is not a valid date and time.` };
      body[field.name] = time.toISOString();
    } else if (field.kind === "url" && !value.startsWith("https://")) {
      return { ok: false, message: `${field.label} must start with https://` };
    } else {
      body[field.name] = value;
    }
  }
  return { ok: true, body };
}

/** The id of the created record in a `{ [key]: { id } }` response, for redirecting to its page. */
export function createdId(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const record = (data as Record<string, unknown>)[key];
  if (typeof record !== "object" || record === null) return null;
  const id = (record as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : null;
}
