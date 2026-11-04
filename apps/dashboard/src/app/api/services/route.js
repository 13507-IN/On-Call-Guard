import { getHealthReport } from "../../../lib/health-checks.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = await getHealthReport();
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Service health could not be collected." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
