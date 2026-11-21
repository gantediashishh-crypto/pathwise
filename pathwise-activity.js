(function attachPathwiseActivity(root, factory) {
  const activity = factory();
  if (typeof module === "object" && module.exports) module.exports = activity;
  else root.PathwiseActivity = activity;
})(globalThis, function createPathwiseActivity() {
  "use strict";

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dayOrdinal(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  }

  function dateKeyFromOrdinal(ordinal) {
    const date = new Date(ordinal * 86400000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function dateKeyAtOffset(offset, now) {
    const date = new Date(now.getTime());
    date.setDate(date.getDate() + offset);
    return localDateKey(date);
  }

  function createTracker({ getState, getRoadmap }) {
    if (typeof getState !== "function" || typeof getRoadmap !== "function") {
      throw new Error("Activity tracker dependencies are incomplete.");
    }

    function streakSummary(now = new Date()) {
      const state = getState();
      const activeDays = new Set(state.activityDays);
      const today = localDateKey(now);
      const activeToday = activeDays.has(today);
      let cursor = dayOrdinal(today) - (activeToday ? 0 : 1);
      let currentStreak = 0;
      while (activeDays.has(dateKeyFromOrdinal(cursor))) {
        currentStreak += 1;
        cursor -= 1;
      }
      const week = Array.from({ length: 7 }, (_, index) => {
        const dateKey = dateKeyAtOffset(index - 6, now);
        const date = new Date(`${dateKey}T12:00:00`);
        return {
          dateKey,
          label: date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
          title: date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }),
          active: activeDays.has(dateKey),
          today: dateKey === today
        };
      });
      return { currentStreak, activeToday, week };
    }

    function recordActivity(now = new Date()) {
      const state = getState();
      const today = localDateKey(now);
      if (!state.activityDays.includes(today)) {
        state.activityDays.push(today);
        state.activityDays = state.activityDays.slice(-365);
      }
    }

    function recordProgressSnapshot(now = new Date()) {
      const state = getState();
      if (!state.profile) return null;
      const roadmap = getRoadmap();
      const totalCredits = roadmap.reduce((total, course) => total + course.credits, 0);
      const completed = roadmap.filter(course => state.completed.includes(course.code));
      const snapshot = {
        date: localDateKey(now),
        creditsCompleted: completed.reduce((total, course) => total + course.credits, 0),
        totalCredits,
        coursesCompleted: completed.length
      };
      state.progressHistory = state.progressHistory.filter(item => item.date !== snapshot.date);
      state.progressHistory.push(snapshot);
      state.progressHistory = state.progressHistory.slice(-90);
      return snapshot;
    }

    return Object.freeze({ streakSummary, recordActivity, recordProgressSnapshot });
  }

  return Object.freeze({ createTracker });
});
