function asText(value, fallback = "Not available.") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item) => {
      if (item && typeof item === "object") {
        const label = item.classification === "confirmed_fact"
          ? "CONFIRMED"
          : item.classification === "hypothesis"
            ? "HYPOTHESIS"
            : "UNCLASSIFIED";
        return `- [${label}] ${item.source ?? "Evidence"}: ${item.observation ?? "No details."}`;
      }
      return `- ${String(item)}`;
    }).join("\n");
  }
  return fallback;
}

export function formatIncidentReply({ incident, investigation, dashboardUrl = null }) {
  const diagnosis = investigation?.diagnosis ?? incident?.investigation?.diagnosis ?? null;
  const incidentId = incident?.incidentId ?? investigation?.incidentId ?? "unknown";
  const status = incident?.investigation?.status ?? investigation?.status ?? "not_started";
  const lines = [
    `On-call incident ${incidentId}`,
    `Investigation status: ${status}`,
  ];
  if (diagnosis) {
    lines.push(
      `Summary: ${asText(diagnosis.summary)}`,
      `Probable cause (not confirmed): ${asText(diagnosis.probableCause)}`,
      `Confidence: ${typeof diagnosis.confidence === "number"
        ? `${Math.round(diagnosis.confidence * 100)}%`
        : "Not available."}`,
      `Evidence:\n${asText(diagnosis.evidence)}`,
      `Approval required before recovery: ${diagnosis.requiresHumanApproval === true
        ? "Yes"
        : diagnosis.requiresHumanApproval === false
          ? "No"
          : "Not specified"}`,
      `Recommended action (advisory; not executed): ${asText(diagnosis.recommendedAction)}`,
      `Risks: ${asText(diagnosis.risk)}`,
      `Next investigation steps:\n${asText(diagnosis.recommendedInvestigationSteps)}`,
      `Relevant logs:\n${asText(diagnosis.relevantLogExcerpts, "No relevant log excerpts available.")}`,
      `Missing information: ${asText(diagnosis.missingInformation, "None reported.")}`,
    );
  } else if (status === "failed") {
    lines.push("The AI investigation failed. No diagnosis is available; an authorized teammate can retry from the dashboard.");
  } else {
    lines.push("No saved diagnosis is available yet.");
  }
  if (dashboardUrl) lines.push(`Dashboard: ${dashboardUrl}`);
  return lines.join("\n");
}
