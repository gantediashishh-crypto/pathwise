(function attachPathwiseSecurity(root, factory) {
  const security = factory(root);
  if (typeof module === "object" && module.exports) module.exports = security;
  else root.PathwiseSecurity = security;
})(globalThis, function createPathwiseSecurity(root) {
  "use strict";

  const PASSWORD_ITERATIONS = 150000;

  function requireCrypto() {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error("Password accounts require a secure browser context such as localhost or HTTPS.");
    }
    return root.crypto;
  }

  function hexToBytes(hex, expectedLength, label) {
    if (typeof hex !== "string" || !/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0 ||
        (expectedLength !== undefined && hex.length !== expectedLength * 2)) {
      throw new Error(`${label || "Hex value"} is invalid.`);
    }
    return new Uint8Array(hex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary);
  }

  function base64ToBytes(value) {
    if (typeof value !== "string" || !value) throw new Error("Encrypted data is invalid.");
    const binary = root.atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  async function hashPassword(password, salt) {
    const cryptoProvider = requireCrypto();
    const key = await cryptoProvider.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const result = await cryptoProvider.subtle.deriveBits({
      name: "PBKDF2",
      salt: hexToBytes(salt, 16, "Password salt"),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    }, key, 256);
    return bytesToHex(new Uint8Array(result));
  }

  async function deriveEncryptionKey(password, salt) {
    const cryptoProvider = requireCrypto();
    const material = await cryptoProvider.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return cryptoProvider.subtle.deriveKey({
      name: "PBKDF2",
      salt: hexToBytes(salt, 16, "Encryption salt"),
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256"
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function encryptAccountData(data, key) {
    const cryptoProvider = requireCrypto();
    const serialized = JSON.stringify(data);
    if (typeof serialized !== "string") throw new Error("Account data could not be serialized.");
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(serialized);
    const ciphertext = await cryptoProvider.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { dataIv: bytesToHex(iv), encryptedData: bytesToBase64(new Uint8Array(ciphertext)) };
  }

  async function decryptAccountData(account, key) {
    const cryptoProvider = requireCrypto();
    const iv = hexToBytes(account && account.dataIv, 12, "Encryption IV");
    const ciphertext = base64ToBytes(account && account.encryptedData);
    const plaintext = await cryptoProvider.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  return Object.freeze({
    bytesToHex,
    hashPassword,
    deriveEncryptionKey,
    encryptAccountData,
    decryptAccountData
  });
});
