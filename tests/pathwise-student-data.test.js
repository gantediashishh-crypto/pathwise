"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Storage = require("../pathwise-storage.js");
const StudentData = require("../pathwise-student-data.js");

const profile = { branch: "Computing", semester: 1, coding: "Beginner", goal: "Data" };
const courses = [{ code: "C101" }, { code: "C102" }];
const mockTests = [{ id: "sample", questions: [{ choices: ["A", "B"] }] }];

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function createRepository(store = createStore()) {
  return {
    store,
    repository: StudentData.createRepository({
      storage: Storage,
      store,
      authKey: "pathwise.auth.test",
      legacyKey: "pathwise.student.test",
      getCourses: () => courses,
      getMockTests: () => mockTests,
      isValidProfile: value => Boolean(value) &&
        value.branch === "Computing" && value.semester === 1 &&
        value.coding === "Beginner" && value.goal === "Data"
    })
  };
}

test("student data normalization bounds fields and drops invalid course and quiz records", () => {
  const { repository } = createRepository();
  const normalized = repository.normalize({
    profile: { ...profile, unexpected: "<script>" },
    completed: ["C101", "<script>"],
    enrolled: ["C102", "UNKNOWN"],
    resume: { fullName: "A".repeat(6000), unknown: "ignored" },
    mockTestResults: [
      { quizId: "sample", score: 1, total: 1, completedAt: "2026-01-01T00:00:00Z" },
      { quizId: "sample", score: "<img>", total: 1, completedAt: "2026-01-01T00:00:00Z" },
      { quizId: "missing", score: 1, total: 1, completedAt: "2026-01-01T00:00:00Z" }
    ],
    activeTest: {
      quizId: "sample",
      index: 0,
      selectedAnswer: 99,
      checked: true,
      answers: ["<script>"]
    }
  });

  assert.deepEqual(normalized.profile, profile);
  assert.deepEqual(normalized.completed, ["C101"]);
  assert.deepEqual(normalized.enrolled, ["C102"]);
  assert.equal(normalized.resume.fullName.length, 5000);
  assert.equal("unknown" in normalized.resume, false);
  assert.deepEqual(normalized.mockTestResults, [
    { quizId: "sample", score: 1, total: 1, completedAt: "2026-01-01T00:00:00Z" }
  ]);
  assert.deepEqual(normalized.activeTest, {
    quizId: "sample",
    index: 0,
    answers: [null],
    checked: true
  });
});

test("saved account and legacy records are parsed through the normalized data model", () => {
  const store = createStore({
    "pathwise.auth.test": JSON.stringify({
      "STUDENT@example.edu": {
        salt: "a".repeat(32),
        passwordHash: "b".repeat(64),
        dataSalt: "c".repeat(32),
        dataIv: "d".repeat(24),
        encryptedData: "YWJj"
      }
    }),
    "pathwise.student.test": JSON.stringify({
      ...profile,
      profile,
      completed: ["C101"],
      email: "STUDENT@example.edu"
    })
  });
  const { repository } = createRepository(store);

  assert.deepEqual(Object.keys(repository.readAccounts()), ["student@example.edu"]);
  const expectedLegacyState = StudentData.defaultState();
  delete expectedLegacyState.activeCourse;
  assert.deepEqual(repository.readLegacyStudent(), {
    ...expectedLegacyState,
    profile,
    completed: ["C101"],
    email: "student@example.edu"
  });
});

test("invalid saved account JSON is surfaced instead of silently discarded", () => {
  const store = createStore({ "pathwise.auth.test": "{" });
  const { repository } = createRepository(store);
  assert.throws(() => repository.readAccounts(), SyntaxError);
});

test("removing one migrated account preserves other accounts and unrelated legacy data", () => {
  const { store, repository } = createRepository();
  const accounts = {
    "first@example.edu": { legacyRecord: { salt: "first" } },
    "second@example.edu": {
      salt: "a".repeat(32),
      passwordHash: "b".repeat(64),
      dataSalt: "c".repeat(32),
      dataIv: "d".repeat(24),
      encryptedData: "YWJj"
    }
  };
  store.setItem("pathwise.student.test", JSON.stringify({ ...profile, email: "other@example.edu" }));
  const legacyStudent = { email: "other@example.edu" };

  const retainedLegacy = repository.removeMigratedData(accounts, "first@example.edu", legacyStudent);

  assert.deepEqual(Object.keys(accounts), ["second@example.edu"]);
  assert.deepEqual(Object.keys(JSON.parse(store.getItem("pathwise.auth.test"))), ["second@example.edu"]);
  assert.equal(retainedLegacy, legacyStudent);
  assert.notEqual(store.getItem("pathwise.student.test"), null);
});
