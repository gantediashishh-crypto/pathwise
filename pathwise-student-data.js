(function attachPathwiseStudentData(root, factory) {
  const studentData = factory();
  if (typeof module === "object" && module.exports) module.exports = studentData;
  else root.PathwiseStudentData = studentData;
})(globalThis, function createPathwiseStudentData() {
  "use strict";

  const RESUME_FIELDS = [
    "fullName", "headline", "location", "summary", "skills",
    "education", "experience", "projects", "links"
  ];

  function defaultState() {
    return {
      email: null, profile: null, completed: [], enrolled: [], activeCourse: null,
      assessmentMarks: {}, labMarks: {}, mockTestResults: [], activeTest: null, practicedQuestions: [],
      interviewSessions: [], mockInterview: null,
      resume: { fullName: "", headline: "", location: "", summary: "", skills: "", education: "", experience: "", projects: "", links: "" },
      savedJobs: [], roadmapTasks: [], activityDays: [], progressHistory: []
    };
  }

  function normalizeEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email) && email.length <= 254
      ? email
      : null;
  }

  function createRepository({ storage, store, authKey, legacyKey, getCourses, getMockTests, isValidProfile }) {
    if (!storage || !store || !authKey || !legacyKey ||
        typeof getCourses !== "function" || typeof getMockTests !== "function" ||
        typeof isValidProfile !== "function") {
      throw new Error("Student data repository dependencies are incomplete.");
    }

    function normalize(value) {
      const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const courses = getCourses();
      const mockTests = getMockTests();
      const resume = source.resume && typeof source.resume === "object" && !Array.isArray(source.resume) ? source.resume : {};
      const normalizedResume = {};
      for (const field of RESUME_FIELDS) {
        normalizedResume[field] = typeof resume[field] === "string" ? resume[field].slice(0, 5000) : "";
      }

      const mockTestResults = Array.isArray(source.mockTestResults)
        ? source.mockTestResults.filter(item => {
          if (!item || typeof item !== "object" || typeof item.completedAt !== "string" ||
              !Number.isFinite(Date.parse(item.completedAt)) || !Number.isInteger(item.score) ||
              !Number.isInteger(item.total)) return false;
          const quiz = mockTests.find(test => test.id === item.quizId);
          return Boolean(quiz) && item.total === quiz.questions.length && item.score >= 0 && item.score <= item.total;
        }).slice(-100).map(item => ({
          quizId: item.quizId,
          score: item.score,
          total: item.total,
          completedAt: item.completedAt
        }))
        : [];
      const activeTestSource = source.activeTest && typeof source.activeTest === "object" && !Array.isArray(source.activeTest)
        ? source.activeTest
        : null;
      const activeQuiz = activeTestSource && mockTests.find(test => test.id === activeTestSource.quizId);
      let activeTest = null;
      if (activeQuiz && Number.isInteger(activeTestSource.index) &&
          activeTestSource.index >= 0 && activeTestSource.index < activeQuiz.questions.length) {
        const selectedAnswer = activeTestSource.selectedAnswer;
        const validSelectedAnswer = Number.isInteger(selectedAnswer) &&
          selectedAnswer >= 0 && selectedAnswer < activeQuiz.questions[activeTestSource.index].choices.length;
        activeTest = {
          quizId: activeQuiz.id,
          index: activeTestSource.index,
          answers: Array.isArray(activeTestSource.answers)
            ? activeTestSource.answers.slice(0, activeQuiz.questions.length).map((answer, index) =>
              Number.isInteger(answer) && answer >= 0 && answer < activeQuiz.questions[index].choices.length ? answer : null)
            : [],
          checked: activeTestSource.checked === true
        };
        if (validSelectedAnswer) activeTest.selectedAnswer = selectedAnswer;
      }

      const interviewSessions = Array.isArray(source.interviewSessions)
        ? source.interviewSessions.filter(item => item && typeof item === "object" && !Array.isArray(item))
          .slice(-100).map(item => ({
            role: typeof item.role === "string" ? item.role.slice(0, 120) : "",
            format: typeof item.format === "string" ? item.format.slice(0, 80) : "",
            completed: item.completed === true,
            completedAt: typeof item.completedAt === "string" && Number.isFinite(Date.parse(item.completedAt)) ? item.completedAt : "",
            answers: Array.isArray(item.answers) ? item.answers.slice(0, 20).map(answer => ({
              prompt: answer && typeof answer.prompt === "string" ? answer.prompt.slice(0, 1000) : "",
              response: answer && typeof answer.response === "string" ? answer.response.slice(0, 5000) : ""
            })) : []
          }))
        : [];
      const interviewSource = source.mockInterview && typeof source.mockInterview === "object" &&
        !Array.isArray(source.mockInterview) ? source.mockInterview : null;
      const mockInterview = interviewSource && typeof interviewSource.role === "string" &&
        typeof interviewSource.format === "string" && Number.isInteger(interviewSource.index) &&
        interviewSource.index >= 0 && Number.isInteger(interviewSource.questionCount) &&
        interviewSource.questionCount > 0 && interviewSource.questionCount <= 8 &&
        interviewSource.index < interviewSource.questionCount
        ? {
          role: interviewSource.role.slice(0, 120),
          format: interviewSource.format.slice(0, 80),
          index: interviewSource.index,
          questionCount: interviewSource.questionCount,
          answers: Array.isArray(interviewSource.answers)
            ? interviewSource.answers.slice(0, 20).map(answer => typeof answer === "string" ? answer.slice(0, 5000) : "")
            : []
        }
        : null;

      return {
        profile: isValidProfile(source.profile) ? {
          branch: source.profile.branch,
          semester: source.profile.semester,
          coding: source.profile.coding,
          goal: source.profile.goal
        } : null,
        completed: Array.isArray(source.completed) ? source.completed.filter(code => courses.some(course => course.code === code)) : [],
        enrolled: Array.isArray(source.enrolled) ? source.enrolled.filter(code => courses.some(course => course.code === code)) : [],
        assessmentMarks: source.assessmentMarks && typeof source.assessmentMarks === "object" && !Array.isArray(source.assessmentMarks) ? source.assessmentMarks : {},
        labMarks: source.labMarks && typeof source.labMarks === "object" && !Array.isArray(source.labMarks) ? source.labMarks : {},
        mockTestResults,
        activeTest,
        practicedQuestions: Array.isArray(source.practicedQuestions) ? source.practicedQuestions.filter(item => typeof item === "string").slice(-500) : [],
        interviewSessions,
        mockInterview,
        resume: normalizedResume,
        savedJobs: Array.isArray(source.savedJobs) ? source.savedJobs.filter(item => typeof item === "string").slice(-200) : [],
        roadmapTasks: Array.isArray(source.roadmapTasks) ? source.roadmapTasks.filter(item => typeof item === "string").slice(-200) : [],
        activityDays: Array.isArray(source.activityDays)
          ? [...new Set(source.activityDays.filter(day => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)))].slice(-365)
          : [],
        progressHistory: Array.isArray(source.progressHistory)
          ? source.progressHistory.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") &&
            Number.isFinite(Number(item.creditsCompleted)) && Number.isFinite(Number(item.totalCredits)) &&
            Number.isFinite(Number(item.coursesCompleted)) && Number(item.creditsCompleted) >= 0 &&
            Number(item.totalCredits) >= 0 && Number(item.coursesCompleted) >= 0)
            .slice(-90)
            .map(item => ({
              date: item.date,
              creditsCompleted: Number(item.creditsCompleted),
              totalCredits: Number(item.totalCredits),
              coursesCompleted: Number(item.coursesCompleted)
            }))
          : []
      };
    }

    function readAccounts() {
      const saved = storage.read(store, authKey);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved accounts are invalid.");
      }
      const accounts = {};
      for (const [rawEmail, value] of Object.entries(parsed)) {
        const email = normalizeEmail(rawEmail);
        if (!email || !value || typeof value !== "object" || Array.isArray(value) ||
            !/^[a-f0-9]{32}$/i.test(value.salt || "") ||
            !/^[a-f0-9]{64}$/i.test(value.passwordHash || "")) continue;
        const hasEncryptedData = /^[a-f0-9]{32}$/i.test(value.dataSalt || "") &&
          /^[a-f0-9]{24}$/i.test(value.dataIv || "") &&
          typeof value.encryptedData === "string" &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedData);
        accounts[email] = hasEncryptedData
          ? {
            salt: value.salt, passwordHash: value.passwordHash, dataSalt: value.dataSalt,
            dataIv: value.dataIv, encryptedData: value.encryptedData, data: null, legacyRecord: null
          }
          : {
            salt: value.salt, passwordHash: value.passwordHash, data: normalize(value),
            legacyRecord: value
          };
      }
      return accounts;
    }

    function readLegacyStudent() {
      const saved = storage.read(store, legacyKey);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved student data is invalid.");
      }
      return { ...normalize(parsed), email: normalizeEmail(parsed.email) };
    }

    function serializeAccounts(accounts) {
      const serialized = {};
      for (const [email, account] of Object.entries(accounts)) {
        if (account.encryptedData) {
          serialized[email] = {
            salt: account.salt,
            passwordHash: account.passwordHash,
            dataSalt: account.dataSalt,
            dataIv: account.dataIv,
            encryptedData: account.encryptedData
          };
        } else if (account.legacyRecord) {
          serialized[email] = account.legacyRecord;
        }
      }
      return serialized;
    }

    function removeMigratedData(accounts, email, legacyStudent, removeUnassignedLegacy = false) {
      if (accounts[email]) delete accounts[email];
      const saved = serializeAccounts(accounts);
      if (Object.keys(saved).length) storage.writeJson(store, authKey, saved);
      else storage.remove(store, authKey);
      const removeLegacy = legacyStudent && (legacyStudent.email === email ||
        (removeUnassignedLegacy && !legacyStudent.email && Object.keys(accounts).length === 0));
      if (!removeLegacy) return legacyStudent;
      storage.remove(store, legacyKey);
      return null;
    }

    return Object.freeze({ normalize, readAccounts, readLegacyStudent, removeMigratedData });
  }

  return Object.freeze({ defaultState, normalizeEmail, createRepository });
});
