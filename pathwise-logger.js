(function attachPathwiseLogger(root, factory) {
  const logger = factory();
  if (typeof module === "object" && module.exports) module.exports = logger;
  else root.PathwiseLogger = logger;
})(globalThis, function createPathwiseLogger() {
  "use strict";

  function createLogger(sink = console, clock = () => new Date()) {
    if (!sink || typeof sink.error !== "function" || typeof sink.info !== "function") {
      throw new Error("A console-compatible log sink is required.");
    }

    function write(level, event, error) {
      if (typeof event !== "string" || !event.trim()) throw new Error("A log event name is required.");
      const record = {
        app: "Pathwise",
        level,
        event,
        timestamp: clock().toISOString()
      };
      if (error) record.errorType = typeof error.name === "string" ? error.name : "Error";
      sink[level](record);
    }

    return Object.freeze({
      info: event => write("info", event),
      error: (event, error) => write("error", event, error)
    });
  }

  return Object.freeze({ createLogger, ...createLogger() });
});
