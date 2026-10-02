/**
 * Server-only Supabase access (#116). The secret key bypasses row level
 * security, so this module must never be imported from client components.
 * Values come from Infisical, synced to Vercel or injected locally with
 * `infisical run`; see docs/supabase.md.
 */

export type SupabaseEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

export type DatabaseHealth =
  | { status: "ok"; latencyMs: number }
  | { status: "unconfigured" }
  | { status: "error"; httpStatus?: number };

/**
 * Confirms the recordings table is reachable with the configured secret key.
 * The HEAD request reads no rows, and failures return only an HTTP status so
 * responses never echo keys or database messages.
 */
export async function checkRecordingsTable(
  env: SupabaseEnv,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => performance.now(),
): Promise<DatabaseHealth> {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return { status: "unconfigured" };

  const started = now();
  try {
    const response = await fetchImpl(
      `${url.replace(/\/+$/, "")}/rest/v1/recordings?select=id&limit=1`,
      {
        method: "HEAD",
        headers: { apikey: key },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return { status: "error", httpStatus: response.status };
    return { status: "ok", latencyMs: Math.round(now() - started) };
  } catch {
    return { status: "error" };
  }
}
