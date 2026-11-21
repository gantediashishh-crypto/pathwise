(function attachPathwiseUi(root) {
  "use strict";

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function renderDailyStreak(streak) {
    const currentStreak = Number.isInteger(streak.currentStreak) && streak.currentStreak >= 0
      ? streak.currentStreak
      : 0;
    const status = streak.activeToday
      ? `<span class="status status-completed"><span class="status-dot" aria-hidden="true"></span>Active today</span>`
      : currentStreak
        ? `<span class="status status-progress"><span class="status-dot" aria-hidden="true"></span>Keep it going</span>`
        : `<span class="status status-available"><span class="status-dot" aria-hidden="true"></span>Ready to start</span>`;
    const week = Array.isArray(streak.week) ? streak.week.slice(-7) : [];
    const weekMarkup = week.map(day => `<div class="streak-day ${day.active ? "is-active" : ""} ${day.today ? "is-today" : ""}" title="${escapeHtml(day.title || "")}"><span>${escapeHtml(day.label || "")}</span><i aria-hidden="true"></i></div>`).join("");
    const message = streak.activeToday
      ? "Your learning activity is recorded for today."
      : currentStreak
        ? "Complete a course, practice, or roadmap task today to continue."
        : "Complete a course, practice, or roadmap task to start a streak.";
    return `<section class="panel glass-panel streak-panel" aria-label="Daily learning streak"><div class="streak-heading"><div><p class="eyebrow">DAILY STREAK</p><div class="streak-count"><strong>${currentStreak}</strong><span>${currentStreak === 1 ? "day" : "days"}</span></div></div>${status}</div><div class="streak-week" role="group" aria-label="Activity for the last seven days">${weekMarkup}</div><p class="streak-copy">${message}</p></section>`;
  }

  function renderProgressChart(entries, totalCredits) {
    const safeEntries = Array.isArray(entries)
      ? entries.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") &&
        Number.isFinite(item.creditsCompleted) && item.creditsCompleted >= 0 &&
        Number.isFinite(item.totalCredits) && item.totalCredits >= 0).slice(-14)
      : [];
    if (!safeEntries.length) return `<div class="progress-chart-empty">Complete a course to start your progress graph.</div>`;
    const width = 640;
    const height = 190;
    const left = 38;
    const right = 12;
    const top = 14;
    const bottom = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const safeTotalCredits = Number.isFinite(totalCredits) && totalCredits >= 0 ? totalCredits : 0;
    const maxCredits = Math.max(1, safeTotalCredits, ...safeEntries.map(item => item.creditsCompleted));
    const points = safeEntries.map((item, index) => {
      const x = safeEntries.length === 1 ? left + plotWidth / 2 : left + (plotWidth * index) / (safeEntries.length - 1);
      const y = top + plotHeight * (1 - item.creditsCompleted / maxCredits);
      return { ...item, x, y };
    });
    const polyline = points.map(point => `${point.x},${point.y}`).join(" ");
    const gridLines = [0, 0.5, 1].map(ratio => {
      const y = top + plotHeight * ratio;
      const label = Math.round(maxCredits * (1 - ratio));
      return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line><text class="chart-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${label}</text>`;
    }).join("");
    const markers = points.map(point => {
      const date = new Date(`${point.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `<circle class="progress-point" cx="${point.x}" cy="${point.y}" r="3"><title>${escapeHtml(date)}: ${point.creditsCompleted} of ${point.totalCredits} credits</title></circle>`;
    }).join("");
    const firstDate = new Date(`${safeEntries[0].date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const lastDate = new Date(`${safeEntries[safeEntries.length - 1].date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const dateLabels = safeEntries.length === 1
      ? `<text class="chart-date-label" x="${left + plotWidth / 2}" y="${height - 8}" text-anchor="middle">${escapeHtml(firstDate)}</text>`
      : `<text class="chart-date-label" x="${left}" y="${height - 8}">${escapeHtml(firstDate)}</text><text class="chart-date-label" x="${width - right}" y="${height - 8}" text-anchor="end">${escapeHtml(lastDate)}</text>`;
    return `<svg class="progress-chart" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="progress-chart-title progress-chart-description"><title id="progress-chart-title">Credits completed over time</title><desc id="progress-chart-description">Daily snapshots of completed credits for this roadmap. The latest value is ${points[points.length - 1].creditsCompleted} of ${points[points.length - 1].totalCredits} credits.</desc>${gridLines}<polyline class="progress-line" points="${polyline}"></polyline>${markers}${dateLabels}</svg>`;
  }

  const ui = Object.freeze({ escapeHtml, renderDailyStreak, renderProgressChart });
  if (typeof module === "object" && module.exports) module.exports = ui;
  else root.PathwiseUi = ui;
})(globalThis);
