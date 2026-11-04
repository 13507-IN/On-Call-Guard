export function parsePort(rawPort, envName, defaultPort) {
  if (rawPort === undefined || String(rawPort).trim() === "") {
    return defaultPort;
  }

  const value = String(rawPort).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${envName} must be an integer between 1 and 65535.`);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${envName} must be an integer between 1 and 65535.`);
  }

  return port;
}
