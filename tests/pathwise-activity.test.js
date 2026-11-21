"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createTracker } = require("../pathwise-activity.js");

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function offsetDateKey(date, offset) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + offset);
  return localDateKey(result);
}

function createState(overrides = {}) {
  return {
    profile: { branch: "Computing" },
    completed: [],
    activityDays: [],
    progressHistory: [],
    ...overrides
  };
}

test("streak calculation includes today when active and otherwise continues from yesterday", () => {
  const now = new Date(2026, 2, 15, 12);
  const state = createState({
    activityDays: [
      offsetDateKey(now, -2),
      offsetDateKey(now, -1),
      localDateKey(now)
    ]
  });
  const tracker = createTracker({ getState: () => state, getRoadmap: () => [] });

  assert.equal(tracker.streakSummary(now).currentStreak, 3);
  assert.equal(tracker.streakSummary(now).activeToday, true);

  state.activityDays = [offsetDateKey(now, -2), offsetDateKey(now, -1)];
  assert.equal(tracker.streakSummary(now).currentStreak, 2);
  assert.equal(tracker.streakSummary(now).activeToday, false);
  assert.equal(tracker.streakSummary(now).week.at(-1).today, true);
});

test("activity is idempotent per day and remains capped at 365 days", () => {
  const now = new Date(2026, 2, 15, 12);
  const state = createState({
    activityDays: Array.from({ length: 365 }, (_, index) =>
      localDateKey(new Date(2025, 0, index + 1, 12)))
  });
  const tracker = createTracker({ getState: () => state, getRoadmap: () => [] });

  tracker.recordActivity(now);
  tracker.recordActivity(now);

  assert.equal(state.activityDays.length, 365);
  assert.equal(state.activityDays.filter(day => day === localDateKey(now)).length, 1);
});

test("progress snapshots replace the same-day record and respect completed course credits", () => {
  const now = new Date(2026, 2, 15, 12);
  const state = createState({ completed: ["C101"] });
  const roadmap = [{ code: "C101", credits: 3 }, { code: "C102", credits: 4 }];
  const tracker = createTracker({ getState: () => state, getRoadmap: () => roadmap });

  assert.deepEqual(tracker.recordProgressSnapshot(now), {
    date: localDateKey(now),
    creditsCompleted: 3,
    totalCredits: 7,
    coursesCompleted: 1
  });
  state.completed.push("C102");
  tracker.recordProgressSnapshot(now);

  assert.equal(state.progressHistory.length, 1);
  assert.equal(state.progressHistory[0].creditsCompleted, 7);
});

test("progress snapshots are not recorded before a profile exists", () => {
  const state = createState({ profile: null });
  const tracker = createTracker({ getState: () => state, getRoadmap: () => [] });

  assert.equal(tracker.recordProgressSnapshot(new Date(2026, 2, 15)), null);
  assert.deepEqual(state.progressHistory, []);
});
