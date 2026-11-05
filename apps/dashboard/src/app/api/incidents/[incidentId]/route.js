import { proxyIncidentApiRequest } from "../../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveIncidentPath(context) {
  const { incidentId } = await context.params;
  if (!UUID_PATTERN.test(incidentId)) return null;
  return `incidents/${encodeURIComponent(incidentId)}`;
}

export async function GET(_request, context) {
  const path = await resolveIncidentPath(context);
  if (!path) {
    return Response.json(
      { error: "Incident ID is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return await proxyIncidentApiRequest(path);
  } catch {
    return Response.json(
      { error: "Incident data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request, context) {
  const path = await resolveIncidentPath(context);
  if (!path) {
    return Response.json(
      { error: "Incident ID is invalid." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return await proxyIncidentApiRequest(path, { method: "PATCH", body });
  } catch {
    return Response.json(
      { error: "Incident service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
