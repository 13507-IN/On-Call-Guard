import { proxyIncidentApiRequest } from "../../../../lib/monitoring-data.js";

export const dynamic = "force-dynamic";

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
    return await proxyIncidentApiRequest("incidents/reports", {
      method: "POST",
      body,
      authorization: request.headers.get("authorization"),
    });
  } catch {
    return Response.json(
      { error: "Incident service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
