import { proxyIncidentApiRequest } from "../../../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request, context) {
  const { incidentId } = await context.params;
  if (!UUID_PATTERN.test(incidentId)) {
    return Response.json(
      { error: { message: "Incident ID is invalid." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    return await proxyIncidentApiRequest(
      `incidents/${encodeURIComponent(incidentId)}/investigations`,
      {
        method: "POST",
        body: {},
        authorization: request.headers.get("authorization"),
      },
      { timeoutMs: 125_000 },
    );
  } catch {
    return Response.json(
      { error: { message: "The investigation service is temporarily unavailable." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
