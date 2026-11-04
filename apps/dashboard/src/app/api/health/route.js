export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "dashboard",
      checkedAt: new Date().toISOString(),
      checks: { process: "ok" },
      scope: "process-only",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
