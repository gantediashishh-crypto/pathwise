"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const Core = require("./pathwise-core.js");
const Logger = require("./pathwise-logger.js");

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const DEFAULT_CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "course-catalog.json"), "utf8"));
const DEFAULT_PORT = 3000;
const SESSION_COOKIE = "pathwise_session";
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_WINDOW_LIMIT = 8;
const AUTH_IP_WINDOW_LIMIT = 60;
const MAX_ENCRYPTED_DATA_LENGTH = 300_000;
const DUMMY_AUTH_SALT = crypto.randomBytes(16).toString("hex");

function openDatabase(databasePath) {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      auth_salt TEXT NOT NULL,
      auth_hash TEXT NOT NULL,
      data_salt TEXT NOT NULL,
      data_iv TEXT,
      encrypted_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
  return db;
}

function normalizeEmail(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email)
    ? email
    : null;
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 8 && Buffer.byteLength(value, "utf8") <= 128;
}

function jsonObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validBase64(value) {
  return typeof value === "string" && value.length > 0 && value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value &&
    Buffer.from(value, "base64").length >= 16;
}

function readCookie(request, name) {
  const cookies = String(request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function validateAuditInput(input, catalog) {
  if (!jsonObject(input) || !Core.isValidProfile(input.profile, catalog.branches, catalog.careers)) {
    return { error: "Choose a valid branch, semester, coding level, and career goal." };
  }
  const allCodes = new Set(catalog.courses.map(course => course.code));
  const completed = input.completed;
  const enrolled = input.enrolled;
  if (!Array.isArray(completed) || !Array.isArray(enrolled) ||
      completed.length > allCodes.size || enrolled.length > allCodes.size ||
      [...completed, ...enrolled].some(code => typeof code !== "string" || !allCodes.has(code))) {
    return { error: "Course progress contains an invalid course code." };
  }
  if (new Set(completed).size !== completed.length || new Set(enrolled).size !== enrolled.length ||
      completed.some(code => enrolled.includes(code))) {
    return { error: "Course progress contains duplicate or conflicting statuses." };
  }

  const courses = Core.getCoursesForProfile(
    input.profile, catalog.courses, catalog.branchCodes, catalog.careerCodes, catalog.sharedCodes
  );
  const roadmap = Core.buildRoadmap(input.profile, courses, completed);
  const roadmapCodes = new Set(roadmap.map(course => course.code));
  const completedSet = new Set(completed);
  const enrolledSet = new Set(enrolled);
  const issues = [];

  for (const code of enrolled) {
    const course = roadmap.find(item => item.code === code);
    if (!course) {
      issues.push({
        code: "COURSE_OUTSIDE_PLAN",
        severity: "review",
        title: "Enrolled course is outside this roadmap",
        detail: `${code} is not recommended for the selected profile.`,
        courseCodes: [code]
      });
    } else {
      const missing = course.prerequisites.filter(prerequisite => !completedSet.has(prerequisite));
      if (missing.length) {
        issues.push({
          code: "PREREQUISITES_NOT_MET",
          severity: "blocked",
          title: "Enrollment prerequisites are incomplete",
          detail: `${code} requires ${missing.join(", ")} to be completed first.`,
          courseCodes: [code, ...missing]
        });
      }
    }
  }

  for (const course of roadmap) {
    if (!completedSet.has(course.code)) continue;
    const missing = course.prerequisites.filter(prerequisite => !completedSet.has(prerequisite));
    if (missing.length) {
      issues.push({
        code: "COMPLETION_REQUIRES_REVIEW",
        severity: "review",
        title: "Completed course has incomplete prerequisites",
        detail: `${course.code} is marked complete while ${missing.join(", ")} is not complete.`,
        courseCodes: [course.code, ...missing]
      });
    }
  }

  const planCourses = roadmap.filter(course => roadmapCodes.has(course.code));
  const completedCredits = planCourses
    .filter(course => completedSet.has(course.code))
    .reduce((sum, course) => sum + course.credits, 0);
  const totalCredits = planCourses.reduce((sum, course) => sum + course.credits, 0);
  const coursesWithStatus = roadmap.map(course => ({
    code: course.code,
    name: course.name,
    credits: course.credits,
    semester: course.roadmapSemester,
    prerequisites: course.prerequisites,
    status: completedSet.has(course.code)
      ? "completed"
      : enrolledSet.has(course.code)
        ? course.prerequisites.every(code => completedSet.has(code)) ? "in-progress" : "locked"
        : course.prerequisites.every(code => completedSet.has(code)) ? "available" : "locked"
  }));
  const recommendations = coursesWithStatus
    .filter(course => course.status === "available")
    .slice(0, 5)
    .map(course => ({ code: course.code, name: course.name, semester: course.semester, credits: course.credits }));

  return {
    report: {
      generatedAt: new Date().toISOString(),
      profile: input.profile,
      summary: {
        recommendedCourses: planCourses.length,
        completedCourses: planCourses.filter(course => completedSet.has(course.code)).length,
        enrolledCourses: enrolledSet.size,
        completedCredits,
        totalCredits,
        completionPercentage: totalCredits ? Math.round((completedCredits / totalCredits) * 100) : 0
      },
      issues,
      recommendations,
      courses: coursesWithStatus
    }
  };
}

function createApp(options = {}) {
  const catalog = options.catalog || DEFAULT_CATALOG;
  Core.topologicalOrder(catalog.courses);
  const db = options.db || openDatabase(options.databasePath || path.join(ROOT, ".pathwise-data", "pathwise.sqlite"));
  const app = express();
  const attempts = new Map();
  const isProduction = process.env.NODE_ENV === "production";

  app.disable("x-powered-by");
  app.set("trust proxy", process.env.PATHWISE_TRUST_PROXY === "1");
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProduction) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    );
    next();
  });
  app.use(express.json({ limit: "350kb", strict: true }));
  app.use("/api", (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();
    const origin = request.get("origin");
    const expectedOrigin = `${request.protocol}://${request.get("host")}`;
    if (origin && origin !== expectedOrigin) return response.status(403).json({ error: "Cross-origin request rejected." });
    next();
  });

  function authRateLimit(request, response, next) {
    const now = Date.now();
    const action = request.path.endsWith("/register") ? "register" : "login";
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const email = normalizeEmail(request.body && request.body.email);
    const keys = action === "register"
      ? [{ key: `register:ip:${ip}`, limit: AUTH_WINDOW_LIMIT }]
      : [
          { key: `login:ip:${ip}`, limit: AUTH_IP_WINDOW_LIMIT },
          ...(email ? [{
            key: `login:account:${crypto.createHash("sha256").update(email).digest("hex")}`,
            limit: AUTH_WINDOW_LIMIT
          }] : [])
        ];
    if (attempts.size > 2000) {
      for (const [attemptKey, entry] of attempts) {
        if (now - entry.startedAt >= AUTH_WINDOW_MS) attempts.delete(attemptKey);
      }
    }
    for (const bucket of keys) {
      const current = attempts.get(bucket.key);
      if (current && now - current.startedAt < AUTH_WINDOW_MS && current.count >= bucket.limit) {
        response.setHeader("Retry-After", String(Math.ceil((AUTH_WINDOW_MS - (now - current.startedAt)) / 1000)));
        const message = action === "register"
          ? "Too many account creation attempts. Try again later."
          : "Too many sign-in attempts. Try again later.";
        return response.status(429).json({ error: message });
      }
    }
    for (const bucket of keys) {
      const current = attempts.get(bucket.key);
      if (!current || now - current.startedAt >= AUTH_WINDOW_MS) {
        attempts.set(bucket.key, { startedAt: now, count: 1 });
      } else {
        current.count += 1;
      }
    }
    next();
  }

  function setSessionCookie(response, token) {
    const secure = isProduction ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_MS / 1000}${secure}`
    );
  }

  function clearSessionCookie(response) {
    const secure = isProduction ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
    );
  }

  function startSession(userId, response) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_LIFETIME_MS;
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), userId, expiresAt);
    setSessionCookie(response, token);
  }

  function requireSession(request, response, next) {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token || token.length > 128) return response.status(401).json({ error: "Sign in to continue." });
    const session = db.prepare(`
      SELECT users.id, users.email, users.data_salt, users.data_iv, users.encrypted_data
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), Date.now());
    if (!session) {
      clearSessionCookie(response);
      return response.status(401).json({ error: "Your session has expired. Sign in again." });
    }
    request.user = session;
    next();
  }

  app.get("/api/health", (request, response) => response.json({ ok: true }));

  app.post("/api/auth/register", authRateLimit, async (request, response) => {
    const email = normalizeEmail(request.body && request.body.email);
    const password = request.body && request.body.password;
    if (!email || !validPassword(password)) {
      return response.status(400).json({ error: "Enter a valid email address and a password of 8 to 128 bytes." });
    }
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
      return response.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    }
    const authSalt = crypto.randomBytes(16).toString("hex");
    const authHash = await scrypt(password, authSalt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const dataSalt = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    let result;
    try {
      result = db.prepare(`
        INSERT INTO users(email, auth_salt, auth_hash, data_salt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(email, authSalt, authHash.toString("hex"), dataSalt, now, now);
    } catch (error) {
      if (error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") {
        return response.status(409).json({ error: "An account with this email already exists. Sign in instead." });
      }
      throw error;
    }
    startSession(Number(result.lastInsertRowid), response);
    response.status(201).json({ email, dataSalt, dataIv: null, encryptedData: null });
  });

  app.post("/api/auth/login", authRateLimit, async (request, response) => {
    const email = normalizeEmail(request.body && request.body.email);
    const password = request.body && request.body.password;
    if (!email || !validPassword(password)) {
      return response.status(400).json({ error: "Enter a valid email address and password." });
    }
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      await scrypt(password, DUMMY_AUTH_SALT, 64, {
        N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
      });
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    const candidate = await scrypt(password, user.auth_salt, 64, {
      N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024
    });
    const expected = Buffer.from(user.auth_hash, "hex");
    if (expected.length !== candidate.length || !crypto.timingSafeEqual(expected, candidate)) {
      return response.status(401).json({ error: "Email or password is incorrect." });
    }
    startSession(user.id, response);
    response.json({
      email: user.email,
      dataSalt: user.data_salt,
      dataIv: user.data_iv,
      encryptedData: user.encrypted_data
    });
  });

  app.get("/api/auth/me", requireSession, (request, response) => {
    response.json({ email: request.user.email });
  });

  app.post("/api/auth/logout", (request, response) => {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.delete("/api/account", requireSession, (request, response) => {
    db.prepare("DELETE FROM users WHERE id = ?").run(request.user.id);
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.get("/api/state", requireSession, (request, response) => {
    response.json({
      email: request.user.email,
      dataSalt: request.user.data_salt,
      dataIv: request.user.data_iv,
      encryptedData: request.user.encrypted_data
    });
  });

  app.put("/api/state", requireSession, (request, response) => {
    const { dataIv, encryptedData } = request.body || {};
    if (typeof dataIv !== "string" || !/^[a-f0-9]{24}$/i.test(dataIv) ||
        typeof encryptedData !== "string" || encryptedData.length > MAX_ENCRYPTED_DATA_LENGTH ||
        !validBase64(encryptedData)) {
      return response.status(400).json({ error: "Encrypted student data is invalid or too large." });
    }
    const updatedAt = new Date().toISOString();
    db.prepare("UPDATE users SET data_iv = ?, encrypted_data = ?, updated_at = ? WHERE id = ?")
      .run(dataIv, encryptedData, updatedAt, request.user.id);
    response.json({ saved: true, updatedAt });
  });

  app.post("/api/advisor-audit", requireSession, (request, response) => {
    const validation = validateAuditInput(request.body, catalog);
    if (validation.error) return response.status(400).json({ error: validation.error });
    response.json(validation.report);
  });

  app.post("/api/course-action", requireSession, (request, response) => {
    const body = request.body;
    const validation = validateAuditInput(body, catalog);
    if (validation.error) return response.status(400).json({ error: validation.error });
    if (typeof body.courseCode !== "string" ||
        !["enroll", "complete"].includes(body.action)) {
      return response.status(400).json({ error: "Course action is invalid." });
    }
    const course = validation.report.courses.find(item => item.code === body.courseCode);
    if (!course) return response.status(404).json({ error: "Course is not part of this roadmap." });
    const expectedStatus = body.action === "enroll" ? "available" : "in-progress";
    if (course.status !== expectedStatus) {
      return response.status(409).json({
        error: body.action === "enroll"
          ? "Prerequisites are not complete or the course is already in progress."
          : "Only an enrolled course with completed prerequisites can be marked complete."
      });
    }
    response.json({ accepted: true, courseCode: course.code, action: body.action });
  });

  app.post("/api/assessment/validate", requireSession, (request, response) => {
    const body = request.body;
    if (!jsonObject(body) || !jsonObject(body.record) ||
        !["theory", "lab"].includes(body.type)) {
      return response.status(400).json({ error: "Assessment record is invalid." });
    }
    const result = body.type === "theory"
      ? Core.assessmentSummary(body.record)
      : Core.labAssessmentSummary(body.record);
    if (!result) return response.status(400).json({ error: "Assessment marks are missing or outside the allowed range." });
    response.json({ valid: true, result });
  });

  app.use("/api", (request, response) => response.status(404).json({ error: "API route not found." }));
  const PUBLIC_FILE = /^\/(?:|index\.html|app\.js|styles\.css|favicon\.svg|privacy\.html|terms\.html|pathwise-logo\.jpg|pathwise-[a-z-]+\.js|data\/(?:course-catalog|mock-tests)\.json)$/;
  app.use((request, response, next) => {
    if (!["GET", "HEAD"].includes(request.method) || PUBLIC_FILE.test(request.path)) return next();
    response.status(404).send("Not found.");
  });
  app.use(express.static(ROOT, { dotfiles: "deny", index: "index.html", fallthrough: true }));
  app.use((request, response) => response.status(404).send("Not found."));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    Logger.error("http.request_failed", error);
    response.status(error.status === 413 ? 413 : 500).json({
      error: error.status === 413 ? "Request body is too large." : "The request could not be completed."
    });
  });

  app.locals.db = db;
  app.locals.closeDatabase = () => db.close();
  return app;
}

if (require.main === module) {
  const configuredPath = process.env.PATHWISE_DB_PATH;
  const databasePath = configuredPath || path.join(ROOT, ".pathwise-data", "pathwise.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const app = createApp({ databasePath });
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  app.listen(port, host, () => {
    Logger.info("server.started");
  });
}

module.exports = { createApp, openDatabase, validateAuditInput, normalizeEmail, validPassword };
