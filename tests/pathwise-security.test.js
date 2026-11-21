"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const Security = require("../pathwise-security.js");

test("password derivation is salted and produces a fixed-size hash", async () => {
  const salt = Security.bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));
  const otherSalt = Security.bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));
  const hash = await Security.hashPassword("pathwise-test-password", salt);

  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await Security.hashPassword("pathwise-test-password", salt), hash);
  assert.notEqual(await Security.hashPassword("pathwise-test-password", otherSalt), hash);
});

test("AES-GCM account data decrypts and rejects tampering or the wrong key", async () => {
  const salt = Security.bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));
  const key = await Security.deriveEncryptionKey("pathwise-test-password", salt);
  const wrongKey = await Security.deriveEncryptionKey("another-test-password", salt);
  const data = { profile: { branch: "Computer Science" }, resume: { fullName: "Test Student" } };
  const encrypted = await Security.encryptAccountData(data, key);

  assert.equal(encrypted.dataIv.length, 24);
  assert.equal(encrypted.encryptedData.includes("Test Student"), false);
  assert.deepEqual(await Security.decryptAccountData(encrypted, key), data);
  await assert.rejects(Security.decryptAccountData(encrypted, wrongKey));

  const altered = {
    ...encrypted,
    encryptedData: `${encrypted.encryptedData[0] === "A" ? "B" : "A"}${encrypted.encryptedData.slice(1)}`
  };
  await assert.rejects(Security.decryptAccountData(altered, key));
});

test("security helpers reject malformed salts and initialization vectors", async () => {
  await assert.rejects(Security.deriveEncryptionKey("password", "not-a-salt"), /salt is invalid/i);
  await assert.rejects(
    Security.decryptAccountData({ dataIv: "abc", encryptedData: "YQ==" }, {}),
    /iv is invalid/i
  );
});
