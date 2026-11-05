import { proxyIncidentApiRequest } from "../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

const FILTERS = ["active", "status", "source", "severity", "applicationId", "limit"];

function cleanQuery(searchParams) {
  const query = new URLSearchParams();
  for (const key of FILTERS) {
    const value = searchParams.get(key);
    if (value !== null) query.set(key, value);
  }
  return query.toString();
}

export async function GET(request) {
  try {
    return await proxyIncidentApiRequest(`incidents?${cleanQuery(new URL(request.url).searchParams)}`);
  } catch {
    return Response.json(
      { error: "Incident data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request) {
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
    return await proxyIncidentApiRequest("incidents", { method: "POST", body });
  } catch {
    return Response.json(
      { error: "Incident service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
