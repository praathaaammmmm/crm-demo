import { errorResponseSchema } from "@crm/contracts/common";

/** Anything with a Zod-style safeParse: every response is checked against its contract. */
export interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

export type ApiFailure =
  | { kind: "unauthenticated" }
  | { kind: "password_change_required" }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found" }
  | { kind: "conflict"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited" }
  | { kind: "unexpected" };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

/** For 204 responses. */
export const noContent: Parser<undefined> = {
  safeParse: (input) => (input === undefined ? { success: true, data: undefined } : { success: false }),
};

const INVALID_BODY = Symbol("invalid body");

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_BODY;
  }
}

const fail = <T>(failure: ApiFailure): ApiResult<T> => ({ ok: false, failure });

/** Maps an API response to a typed result. Shared by browser and server code. */
export async function interpretResponse<T>(response: Response, parser: Parser<T>): Promise<ApiResult<T>> {
  const body = await readBody(response);

  if (response.ok) {
    const parsed = parser.safeParse(body);
    return parsed.success ? { ok: true, data: parsed.data } : fail({ kind: "unexpected" });
  }

  const error = errorResponseSchema.safeParse(body);
  const code = error.success ? error.data.code : undefined;
  const message = error.success ? error.data.message : undefined;

  switch (response.status) {
    case 400:
      return fail({ kind: "invalid", message: message ?? "Please check the form and try again." });
    case 401:
      return fail({ kind: "unauthenticated" });
    case 403:
      return code === "PASSWORD_CHANGE_REQUIRED"
        ? fail({ kind: "password_change_required" })
        : fail({ kind: "forbidden", message: message ?? "You do not have access to this." });
    case 404:
      return fail({ kind: "not_found" });
    case 409:
      return fail({ kind: "conflict", message: message ?? "This action is no longer possible." });
    case 429:
      return fail({ kind: "rate_limited" });
    default:
      return fail({ kind: "unexpected" });
  }
}

/** Fixed, safe text for each failure. Never includes raw response bodies. */
export function failureMessage(failure: ApiFailure): string {
  switch (failure.kind) {
    case "invalid":
    case "forbidden":
    case "conflict":
      return failure.message;
    case "unauthenticated":
      return "Your session has ended. Please sign in again.";
    case "password_change_required":
      return "You must change your password first.";
    case "not_found":
      return "This item no longer exists.";
    case "rate_limited":
      return "Too many attempts. Try again in a minute.";
    case "unexpected":
      return "Something went wrong. Try again.";
  }
}

/** Sends the user to /login or /change-password when a client action reveals either state. */
export function redirectForSession(router: { replace(href: string): void }, failure: ApiFailure): boolean {
  if (failure.kind === "unauthenticated") {
    router.replace("/login");
    return true;
  }
  if (failure.kind === "password_change_required") {
    router.replace("/change-password");
    return true;
  }
  return false;
}

/**
 * Browser-side call to the same-origin /api/v1 rewrite. The browser adds its Origin header and the
 * HttpOnly session cookie; this code never reads either.
 */
export async function apiRequest<T>(
  path: string,
  parser: Parser<T>,
  options: { method: "GET" | "POST" | "PATCH"; body?: unknown } = { method: "GET" },
): Promise<ApiResult<T>> {
  const init: RequestInit = { method: options.method, credentials: "same-origin", cache: "no-store" };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  try {
    return await interpretResponse(await fetch(`/api/v1${path}`, init), parser);
  } catch {
    return fail({ kind: "unexpected" });
  }
}
