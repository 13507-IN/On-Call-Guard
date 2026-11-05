const MAX_TEXT_LENGTH = 4_000;
const MAX_LIST_ITEMS = 30;
const MAX_EVIDENCE_ITEMS = 40;

function boundedText(value, field, maximum = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  const text = value.trim();
  if (text.length === 0 || text.length > maximum) {
    throw new Error(`${field} must contain between 1 and ${maximum} characters.`);
  }
  return text;
}

function stringList(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${field} must be an array with at most ${MAX_LIST_ITEMS} items.`);
  }
  const items = value.map((item, index) =>
    boundedText(item, `${field}[${index}]`, MAX_TEXT_LENGTH),
  );
  if (required && items.length === 0) throw new Error(`${field} must not be empty.`);
  return items;
}

export function validateDiagnosis(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Diagnosis must be an object.");
  }

  const {
    summary,
    probableCause,
    evidence,
    relevantLogExcerpts,
    confidence,
    recommendedInvestigationSteps,
    recommendedAction,
    risk,
    missingInformation,
    requiresHumanApproval,
  } = input;

  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`evidence must be an array with at most ${MAX_EVIDENCE_ITEMS} items.`);
  }
  const normalizedEvidence = evidence.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`evidence[${index}] must be an object.`);
    }
    if (!["confirmed_fact", "hypothesis"].includes(item.classification)) {
      throw new Error(`evidence[${index}].classification is unsupported.`);
    }
    return {
      source: boundedText(item.source, `evidence[${index}].source`, 200),
      observation: boundedText(item.observation, `evidence[${index}].observation`, 1_000),
      classification: item.classification,
    };
  });

  if (typeof confidence !== "number" || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1) {
    throw new Error("confidence must be a number between 0 and 1.");
  }
  if (requiresHumanApproval !== true) {
    throw new Error("requiresHumanApproval must be true.");
  }

  return {
    summary: boundedText(summary, "summary"),
    probableCause: boundedText(probableCause, "probableCause"),
    evidence: normalizedEvidence,
    relevantLogExcerpts: stringList(relevantLogExcerpts, "relevantLogExcerpts"),
    confidence,
    recommendedInvestigationSteps: stringList(
      recommendedInvestigationSteps,
      "recommendedInvestigationSteps",
      { required: true },
    ),
    recommendedAction: boundedText(recommendedAction, "recommendedAction"),
    risk: boundedText(risk, "risk"),
    missingInformation: stringList(missingInformation, "missingInformation"),
    requiresHumanApproval: true,
  };
}

export function mergeDiagnosisLimitations(diagnosis, limitations) {
  const validated = validateDiagnosis(diagnosis);
  const known = new Set(validated.missingInformation.map((item) => item.toLowerCase()));
  const additional = limitations.filter((item) => !known.has(item.toLowerCase()));
  return {
    ...validated,
    missingInformation: [...validated.missingInformation, ...additional]
      .slice(0, MAX_LIST_ITEMS),
  };
}

export const DIAGNOSIS_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    probableCause: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    evidence: {
      type: "array",
      maxItems: MAX_EVIDENCE_ITEMS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", minLength: 1, maxLength: 200 },
          observation: { type: "string", minLength: 1, maxLength: 1_000 },
          classification: { enum: ["confirmed_fact", "hypothesis"] },
        },
        required: ["source", "observation", "classification"],
      },
    },
    relevantLogExcerpts: {
      type: "array",
      maxItems: MAX_LIST_ITEMS,
      items: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    recommendedInvestigationSteps: {
      type: "array",
      minItems: 1,
      maxItems: MAX_LIST_ITEMS,
      items: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    },
    recommendedAction: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    risk: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    missingInformation: {
      type: "array",
      maxItems: MAX_LIST_ITEMS,
      items: { type: "string", minLength: 1, maxLength: MAX_TEXT_LENGTH },
    },
    requiresHumanApproval: { const: true },
  },
  required: [
    "summary",
    "probableCause",
    "evidence",
    "relevantLogExcerpts",
    "confidence",
    "recommendedInvestigationSteps",
    "recommendedAction",
    "risk",
    "missingInformation",
    "requiresHumanApproval",
  ],
});
