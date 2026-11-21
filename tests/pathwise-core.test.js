"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../pathwise-core.js");
const Catalog = require("../data/course-catalog.json");
const MockTests = require("../data/mock-tests.json");

const course = (code, semester, prerequisites = []) => ({
  code,
  semester,
  prerequisites
});

const sequence = [
  course("FOUNDATION", 1),
  course("DATA", 2, ["FOUNDATION"]),
  course("ALGORITHMS", 3, ["DATA"])
];

test("topological ordering places every prerequisite first", () => {
  const shuffled = [sequence[2], sequence[0], sequence[1]];
  const ordered = Core.topologicalOrder(shuffled);
  const positions = new Map(ordered.map((item, index) => [item.code, index]));

  for (const item of ordered) {
    for (const prerequisite of item.prerequisites) {
      assert.ok(positions.get(prerequisite) < positions.get(item.code));
    }
  }
});

test("topological ordering rejects cycles, unknown prerequisites, and duplicate codes", () => {
  assert.throws(() => Core.topologicalOrder([
    course("A", 1, ["B"]),
    course("B", 2, ["A"])
  ]), /prerequisite cycle/i);
  assert.throws(() => Core.topologicalOrder([course("A", 1, ["MISSING"])]), /unknown prerequisite/i);
  assert.throws(() => Core.topologicalOrder([course("A", 1), course("A", 2)]), /duplicate course code/i);
});

test("recommendations include the transitive prerequisite closure", () => {
  const recommended = Core.getCoursesForProfile(
    { branch: "Computing", goal: "Data" },
    sequence,
    { Computing: [] },
    { Data: ["ALGORITHMS"] },
    []
  );
  assert.deepEqual(recommended.map(item => item.code), ["FOUNDATION", "DATA", "ALGORITHMS"]);
});

test("roadmap schedules unfinished prerequisites in earlier semesters", () => {
  const roadmap = Core.buildRoadmap({ semester: 1 }, sequence);
  assert.deepEqual(roadmap.map(item => item.roadmapSemester), [1, 2, 3]);
});

test("completed prerequisites do not delay the next course", () => {
  const roadmap = Core.buildRoadmap({ semester: 2 }, sequence, ["FOUNDATION"]);
  assert.deepEqual(roadmap.map(item => item.roadmapSemester), [2, 2, 3]);
});

test("profile validation checks branch, semester, coding level, and career", () => {
  const branches = ["Computing"];
  const careers = ["Data"];
  const valid = { branch: "Computing", semester: 1, coding: "Beginner", goal: "Data" };
  assert.equal(Core.isValidProfile(valid, branches, careers), true);
  assert.equal(Core.isValidProfile({ ...valid, semester: 0 }, branches, careers), false);
  assert.equal(Core.isValidProfile({ ...valid, coding: "Expert" }, branches, careers), false);
});

test("external catalog has complete prerequisite closure for every profile path", () => {
  assert.equal(new Set(Catalog.courses.map(item => item.code)).size, Catalog.courses.length);
  Core.topologicalOrder(Catalog.courses);
  for (const branch of Catalog.branches) {
    for (const goal of Catalog.careers) {
      const courses = Core.getCoursesForProfile(
        { branch, goal }, Catalog.courses, Catalog.branchCodes, Catalog.careerCodes, Catalog.sharedCodes
      );
      const included = new Set(courses.map(item => item.code));
      const roadmap = Core.buildRoadmap({ semester: 1 }, courses);
      const terms = new Map(roadmap.map(item => [item.code, item.roadmapSemester]));
      for (const item of roadmap) {
        for (const prerequisite of item.prerequisites) {
          assert.ok(included.has(prerequisite), `${item.code} is missing ${prerequisite} for ${branch}/${goal}`);
          assert.ok(terms.get(prerequisite) < terms.get(item.code), `${item.code} is scheduled too early`);
        }
      }
    }
  }
});

test("external mock-test questions have valid answer keys", () => {
  assert.ok(MockTests.length > 0);
  assert.equal(new Set(MockTests.map(item => item.id)).size, MockTests.length);
  for (const mockTest of MockTests) assert.equal(Core.scoreQuiz(mockTest.questions, []).total, mockTest.questions.length);
});

test("theory assessment uses the stated CIE formula and pass thresholds", () => {
  const result = Core.assessmentSummary({
    mid1: 20, mid2: 20, assignment1: 5, assignment2: 5, viva: 5, see: 21
  });
  assert.deepEqual(result, { cie: 30, see: 21, total: 51, passed: true });
  assert.equal(Core.assessmentSummary({
    mid1: 0, mid2: 0, assignment1: 0, assignment2: 0, viva: 0, see: 21
  }).passed, false);
  assert.equal(Core.assessmentSummary({
    mid1: 20, mid2: 20, assignment1: 5, assignment2: 5, viva: 5, see: 20
  }).passed, false);
});

test("theory assessment rejects missing, non-numeric, and out-of-range marks", () => {
  const valid = { mid1: 0, mid2: 0, assignment1: 0, assignment2: 0, viva: 0, see: 0 };
  assert.equal(Core.assessmentSummary({ ...valid, mid1: "" }), null);
  assert.equal(Core.assessmentSummary({ ...valid, see: "not a mark" }), null);
  assert.equal(Core.assessmentSummary({ ...valid, assignment1: 6 }), null);
});

test("laboratory marks total 40 internal and 60 external", () => {
  assert.deepEqual(Core.labAssessmentSummary({
    record: 15,
    internalTest: 15,
    vivaProject: 10,
    writeup: 10,
    execution: 30,
    analysis: 10,
    externalViva: 10
  }), { internal: 40, external: 60, total: 100 });
  assert.equal(Core.labAssessmentSummary({
    record: 16,
    internalTest: 0,
    vivaProject: 0,
    writeup: 0,
    execution: 0,
    analysis: 0,
    externalViva: 0
  }), null);
});

test("mock-test scoring handles correct, incorrect, and unanswered questions", () => {
  const questions = [
    { choices: ["A", "B"], answer: 1 },
    { choices: ["A", "B"], answer: 0 },
    { choices: ["A", "B"], answer: 1 }
  ];
  assert.deepEqual(Core.scoreQuiz(questions, [1, 1]), { score: 1, total: 3 });
  assert.deepEqual(Core.scoreQuiz(questions, [1, 0, 1]), { score: 3, total: 3 });
  assert.throws(() => Core.scoreQuiz([], []), /quiz and its submitted answers/i);
  assert.throws(() => Core.scoreQuiz([{ choices: ["A"], answer: 2 }], []), /invalid answer key/i);
});
