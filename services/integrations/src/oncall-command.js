const COMMANDS = new Set(["report", "status", "investigate", "diagnosis", "action"]);

export function parseOncallCommand(value) {
  if (typeof value !== "string") {
    return { kind: "invalid", message: "The message text is missing." };
  }

  const match = /^\s*oncall(?:\s+([^\s]+))?(?:\s+([\s\S]*))?\s*$/i.exec(value);
  if (!match) return { kind: "not_oncall" };

  const action = (match[1] ?? "").toLowerCase();
  const details = (match[2] ?? "").trim();
  if (!action || action === "help") {
    return {
      kind: "help",
      commands: [...COMMANDS],
    };
  }
  if (!COMMANDS.has(action)) {
    return {
      kind: "unknown",
      commands: [...COMMANDS],
    };
  }

  return { kind: "command", action, details };
}
