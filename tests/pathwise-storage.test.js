"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Storage = require("../pathwise-storage.js");

test("JSON storage writes and reads serialized records", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const record = { completed: ["CS101"] };

  Storage.writeJson(storage, "pathwise.test", record);
  assert.deepEqual(JSON.parse(Storage.read(storage, "pathwise.test")), record);
  Storage.remove(storage, "pathwise.test");
  assert.equal(Storage.read(storage, "pathwise.test"), null);
});

test("storage write failures propagate to the caller", () => {
  const quotaError = new Error("Quota exceeded");
  const storage = { setItem() { throw quotaError; } };

  assert.throws(() => Storage.writeJson(storage, "pathwise.test", { value: 1 }), error => error === quotaError);
  assert.throws(() => Storage.writeJson(storage, "pathwise.test", undefined), /could not be serialized/i);
});
