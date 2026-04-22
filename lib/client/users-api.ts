// Tiny client-side fetcher for the /api/settings/users JSON endpoint.
// Used by UsersManagement and EditUserDialog. We route through this one
// helper so every call has uniform error handling and the "unexpected
// response" symptom that plagued the old Server Actions flow cannot
// re-appear — the response is always JSON, and parse failures become
// plain `{error}` objects the caller can toast.

export type UsersApiBody =
  | { action: "invite"; email: string; full_name: string; roles: string[] }
  | { action: "update_roles"; user_id: string; roles: string[] }
  | { action: "set_active"; user_id: string; is_active: boolean }
  | {
      action: "update_profile";
      user_id: string;
      full_name?: string;
      phone?: string | null;
    }
  | { action: "set_password"; user_id: string; password: string }
  | { action: "delete"; user_id: string }
  | { action: "resend_invite"; email: string };

export async function callUsersApi(
  body: UsersApiBody,
): Promise<{ error?: string; success?: true }> {
  let res: Response;
  try {
    res = await fetch("/api/settings/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Include cookies so the route handler sees the user's Supabase session.
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failure (offline, aborted, etc.)
    return {
      error:
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
    };
  }

  // Try to parse JSON regardless of status code — our route handler returns
  // `{error}` objects with 200 by design so the protocol is uniform.
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    return {
      error: res.ok
        ? "Server returned an empty response. Please try again."
        : `Request failed with status ${res.status}`,
    };
  }

  if (data && typeof data === "object") {
    return data as { error?: string; success?: true };
  }
  return { error: "Unexpected server response." };
}
