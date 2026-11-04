function write(level, service, event, fields = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    ...fields,
  };
  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(service) {
  return Object.freeze({
    info(event, fields) {
      write("info", service, event, fields);
    },
    warn(event, fields) {
      write("warn", service, event, fields);
    },
    error(event, fields) {
      write("error", service, event, fields);
    },
  });
}
