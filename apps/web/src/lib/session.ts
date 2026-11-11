import { sessionResponseSchema, type SessionResponse } from "@crm/contracts/identity";
import { redirect } from "next/navigation";
import { cache } from "react";
import { serverGet } from "./server-api";

/** The signed-in user, or null. Fetched once per request. Throws on unexpected API failures. */
export const getSession = cache(async (): Promise<SessionResponse | null> => {
  const result = await serverGet("/auth/me", sessionResponseSchema);
  if (result.ok) return result.data;
  if (result.failure.kind === "unauthenticated") return null;
  throw new Error("Could not load the current session");
});

/** For the main app: signed in and no pending password change. */
export async function requireAppSession(): Promise<SessionResponse> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/change-password");
  return session;
}

/** For /change-password: signed in, and only while a password change is pending. */
export async function requireGateSession(): Promise<SessionResponse> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/");
  return session;
}
