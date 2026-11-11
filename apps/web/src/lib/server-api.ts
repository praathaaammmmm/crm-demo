import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { interpretResponse, type ApiResult, type Parser } from "./api-client";

/** Server-only: reads through API_INTERNAL_URL, forwarding only the session cookie. */

const SESSION_COOKIE = "crm_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function apiUrl(path: string, params: Record<string, string>): URL {
  const base = process.env["API_INTERNAL_URL"];
  if (!base) throw new Error("API_INTERNAL_URL is not set");
  const url = new URL(`/api/v1${path}`, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function serverGet<T>(
  path: string,
  parser: Parser<T>,
  params: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Forward only a well-formed token, so a tampered cookie cannot inject other header content.
  const headers: Record<string, string> = token && TOKEN_PATTERN.test(token) ? { cookie: `${SESSION_COOKIE}=${token}` } : {};
  const response = await fetch(apiUrl(path, params), { headers, cache: "no-store" });
  return interpretResponse(response, parser);
}

/**
 * For page reads: redirects on session problems, 404s on not_found, throws (to error.tsx) on
 * unexpected failures. Returns data, or "forbidden" so the page can show its not-allowed state.
 */
export function dataOrForbidden<T>(result: ApiResult<T>): T | "forbidden" {
  if (result.ok) return result.data;
  const { kind } = result.failure;
  if (kind === "unauthenticated") redirect("/login");
  if (kind === "password_change_required") redirect("/change-password");
  if (kind === "forbidden") return "forbidden";
  if (kind === "not_found") notFound();
  throw new Error("API request failed");
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Reads up to maxPages pages and reports whether more exist, so counts are never silently wrong. */
export async function collectPages<T>(
  path: string,
  parser: Parser<Page<T>>,
  params: Record<string, string> = {},
  maxPages = 5,
): Promise<ApiResult<{ items: T[]; truncated: boolean }>> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result: ApiResult<Page<T>> = await serverGet(path, parser, cursor === null ? params : { ...params, cursor });
    if (!result.ok) return result;
    items.push(...result.data.items);
    cursor = result.data.nextCursor;
    if (cursor === null) return { ok: true, data: { items, truncated: false } };
  }
  return { ok: true, data: { items, truncated: true } };
}
