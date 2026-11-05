import { getOpenIncidents } from "../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getOpenIncidents(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Incident data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
