import { checkRecordingsTable } from "../../../server/supabase";

export const dynamic = "force-dynamic";

/**
 * Deployment health check for the recordings database (#116). Live playing
 * never calls this route; it only verifies hosted configuration.
 */
export async function GET() {
  const database = await checkRecordingsTable({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return Response.json(
    { database },
    {
      status: database.status === "ok" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
