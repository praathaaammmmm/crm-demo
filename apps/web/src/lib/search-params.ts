/** Helpers for reading page URL parameters safely and building filter links. */

export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A single string value, or undefined for missing or repeated parameters. */
export const readParam = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
};

/** Builds a link from defined parameters only, so links never carry empty values. */
export function hrefWith(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  const text = query.toString();
  return text.length > 0 ? `${path}?${text}` : path;
}
