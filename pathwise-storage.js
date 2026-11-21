(function attachPathwiseStorage(root, factory) {
  const storage = factory();
  if (typeof module === "object" && module.exports) module.exports = storage;
  else root.PathwiseStorage = storage;
})(globalThis, function createPathwiseStorage() {
  "use strict";

  function read(storage, key) {
    if (!storage || typeof storage.getItem !== "function") {
      throw new Error("Browser storage is unavailable.");
    }
    return storage.getItem(key);
  }

  function writeJson(storage, key, value) {
    if (!storage || typeof storage.setItem !== "function") {
      throw new Error("Browser storage is unavailable.");
    }
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") throw new Error("Saved data could not be serialized.");
    storage.setItem(key, serialized);
  }

  function remove(storage, key) {
    if (!storage || typeof storage.removeItem !== "function") {
      throw new Error("Browser storage is unavailable.");
    }
    storage.removeItem(key);
  }

  return Object.freeze({ read, writeJson, remove });
});
