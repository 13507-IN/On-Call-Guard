import { proxyIncidentApiRequest } from "../../../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request, context) {
  const { incidentId } = await context.params;
  if (!UUID_PATTERN.test(incidentId)) {
    return Response.json(
      { error: "Incident ID is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return await proxyIncidentApiRequest(
      `incidents/${encodeURIComponent(incidentId)}/history`,
    );
  } catch {
    return Response.json(
      { error: "Incident history is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
