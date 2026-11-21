"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Logger = require("../pathwise-logger.js");

test("structured logs include a stable event and error type without error details", () => {
  const records = [];
  const sink = {
    info: record => records.push(record),
    error: record => records.push(record)
  };
  const logger = Logger.createLogger(sink, () => new Date("2026-01-02T03:04:05.000Z"));

  logger.info("app.started");
  logger.error("state.sync_failed", new Error("contains private request data"));

  assert.deepEqual(records, [
    { app: "Pathwise", level: "info", event: "app.started", timestamp: "2026-01-02T03:04:05.000Z" },
    {
      app: "Pathwise",
      level: "error",
      event: "state.sync_failed",
      timestamp: "2026-01-02T03:04:05.000Z",
      errorType: "Error"
    }
  ]);
});

test("structured logging rejects empty event names", () => {
  const logger = Logger.createLogger({ info() {}, error() {} });
  assert.throws(() => logger.info(" "), /event name/i);
});
