(function attachPathwiseCore(root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.PathwiseCore = core;
})(globalThis, function createPathwiseCore() {
  "use strict";

  function isValidProfile(profile, branches, careers) {
    return Boolean(profile) &&
      branches.includes(profile.branch) &&
      Number.isInteger(profile.semester) && profile.semester >= 1 && profile.semester <= 8 &&
      ["None", "Beginner", "Intermediate"].includes(profile.coding) &&
      careers.includes(profile.goal);
  }

  function topologicalOrder(courses) {
    const byCode = new Map();
    for (const course of courses) {
      if (!course || typeof course.code !== "string" || !course.code) {
        throw new Error("Every course must have a non-empty code.");
      }
      if (byCode.has(course.code)) throw new Error(`Duplicate course code: ${course.code}.`);
      if (!Array.isArray(course.prerequisites)) {
        throw new Error(`Prerequisites must be an array for ${course.code}.`);
      }
      byCode.set(course.code, course);
    }

    const indegree = new Map(courses.map(course => [course.code, 0]));
    const dependents = new Map(courses.map(course => [course.code, []]));
    for (const course of courses) {
      const prerequisites = new Set();
      for (const prerequisite of course.prerequisites) {
        if (prerequisites.has(prerequisite)) {
          throw new Error(`Duplicate prerequisite ${prerequisite} for ${course.code}.`);
        }
        prerequisites.add(prerequisite);
        if (!byCode.has(prerequisite)) {
          throw new Error(`Unknown prerequisite ${prerequisite} required by ${course.code}.`);
        }
        indegree.set(course.code, indegree.get(course.code) + 1);
        dependents.get(prerequisite).push(course.code);
      }
    }

    const compareCourses = (a, b) => a.semester - b.semester || a.code.localeCompare(b.code);
    const ready = courses.filter(course => indegree.get(course.code) === 0).sort(compareCourses);
    const sorted = [];
    while (ready.length) {
      const course = ready.shift();
      sorted.push(course);
      for (const dependentCode of dependents.get(course.code)) {
        indegree.set(dependentCode, indegree.get(dependentCode) - 1);
        if (indegree.get(dependentCode) === 0) {
          ready.push(byCode.get(dependentCode));
          ready.sort(compareCourses);
        }
      }
    }
    if (sorted.length !== courses.length) {
      throw new Error("The course catalog contains a prerequisite cycle.");
    }
    return sorted;
  }

  function getCoursesForProfile(profile, catalog, branchCodes, careerCodes, sharedCodes) {
    if (!profile) return [];
    const wanted = new Set([
      ...sharedCodes,
      ...(branchCodes[profile.branch] || []),
      ...(careerCodes[profile.goal] || [])
    ]);
    const byCode = new Map(catalog.map(course => [course.code, course]));
    const pending = [...wanted];
    while (pending.length) {
      const code = pending.pop();
      const course = byCode.get(code);
      if (!course) throw new Error(`Recommendation references unknown course ${code}.`);
      for (const prerequisite of course.prerequisites) {
        if (!wanted.has(prerequisite)) {
          wanted.add(prerequisite);
          pending.push(prerequisite);
        }
      }
    }
    return catalog.filter(course => wanted.has(course.code));
  }

  function buildRoadmap(profile, courses, completedCodes = []) {
    if (!profile || !Number.isInteger(profile.semester) || profile.semester < 1 || profile.semester > 8) {
      throw new Error("A valid current semester is required to build the roadmap.");
    }
    const completed = new Set(completedCodes);
    const assignedTerm = new Map();
    const sorted = topologicalOrder(courses);
    for (const course of sorted) {
      const unfinishedPrerequisiteTerms = course.prerequisites
        .filter(code => !completed.has(code))
        .map(code => assignedTerm.get(code));
      const earliestPrerequisiteTerm = unfinishedPrerequisiteTerms.length
        ? Math.max(...unfinishedPrerequisiteTerms) + 1
        : profile.semester;
      assignedTerm.set(course.code, Math.max(profile.semester, course.semester, earliestPrerequisiteTerm));
    }
    return sorted.map(course => ({ ...course, roadmapSemester: assignedTerm.get(course.code) }));
  }

  function validatedMarks(record, keys, maxima) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const values = keys.map(key => {
      const raw = record[key];
      if (raw === null || raw === undefined || String(raw).trim() === "") return NaN;
      return Number(raw);
    });
    if (values.some((value, index) => !Number.isFinite(value) || value < 0 || value > maxima[index])) return null;
    return values;
  }

  function assessmentSummary(record) {
    const values = validatedMarks(
      record,
      ["mid1", "mid2", "assignment1", "assignment2", "viva", "see"],
      [30, 30, 5, 5, 5, 60]
    );
    if (!values) return null;
    const cie = (values[0] + values[1]) / 2 + (values[2] + values[3]) / 2 + values[4];
    const see = values[5];
    const total = cie + see;
    return { cie, see, total, passed: see >= 21 && total >= 40 };
  }

  function labAssessmentSummary(record) {
    const values = validatedMarks(
      record,
      ["record", "internalTest", "vivaProject", "writeup", "execution", "analysis", "externalViva"],
      [15, 15, 10, 10, 30, 10, 10]
    );
    if (!values) return null;
    const internal = values.slice(0, 3).reduce((sum, value) => sum + value, 0);
    const external = values.slice(3).reduce((sum, value) => sum + value, 0);
    return { internal, external, total: internal + external };
  }

  function scoreQuiz(questions, answers) {
    if (!Array.isArray(questions) || questions.length === 0 || !Array.isArray(answers)) {
      throw new Error("A quiz and its submitted answers are required.");
    }
    for (const question of questions) {
      if (!question || !Array.isArray(question.choices) ||
          !Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.choices.length) {
        throw new Error("The quiz contains an invalid answer key.");
      }
    }
    const score = questions.reduce((total, question, index) => total + (answers[index] === question.answer ? 1 : 0), 0);
    return { score, total: questions.length };
  }

  return Object.freeze({
    isValidProfile,
    topologicalOrder,
    getCoursesForProfile,
    buildRoadmap,
    assessmentSummary,
    labAssessmentSummary,
    scoreQuiz
  });
});
