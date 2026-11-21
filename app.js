(() => {
  "use strict";

  const Core = window.PathwiseCore;
  const Security = window.PathwiseSecurity;
  const Persistence = window.PathwiseStorage;
  const Api = window.PathwiseApi;
  const Ui = window.PathwiseUi;
  const StudentData = window.PathwiseStudentData;
  const Logger = window.PathwiseLogger;
  const Activity = window.PathwiseActivity;
  if (!Core || !Security || !Persistence || !Api || !Ui || !StudentData || !Logger || !Activity) {
    throw new Error("A required Pathwise module was not loaded.");
  }
  const apiRequest = Api.request;
  const escapeHtml = Ui.escapeHtml;
  const defaultState = StudentData.defaultState;

  const STORAGE_KEY = "pathwise.student.v1";
  const AUTH_STORAGE_KEY = "pathwise.auth.v1";
  let studentDataRepository;
  let BRANCHES;
  let CAREERS;
  let COURSES;

  let CAREER_CODES;
  let BRANCH_CODES;
  let SHARED_CODES;
  const { YEAR_ROADMAP, INTERVIEW_TOPICS, CAREER_PATHS, LEARNING_RESOURCES } = window.PathwiseContent;
  let MOCK_TESTS;
  const app = document.getElementById("app");
  const toast = document.getElementById("toast");
  let toastTimer;
  let accountEncryptionKey = null;
  let accountSaveQueue = Promise.resolve();
  let authAccounts = {};
  let legacyStudent = null;
  let state = defaultState();
  let lastSavedState = defaultState();
  let syncStatus = "saved";
  let authSubmitting = false;
  let authMode = "login";
  let emailDraft = "";
  let mobileMenuOpen = false;
  let mockTestSearchQuery = "";
  let catalogFilters = { search: "", semester: "", difficulty: "", status: "" };
  let mockTestSectionFilter = "";
  let interviewSearchQuery = "";
  let jobSearchQuery = "";
  const activityTracker = Activity.createTracker({
    getState: () => state,
    getRoadmap: () => getRoadmap()
  });
  const recordActivity = activityTracker.recordActivity;
  const recordProgressSnapshot = activityTracker.recordProgressSnapshot;

  function storedAccountData(value) {
    if (!studentDataRepository) throw new Error("Student data repository is not initialized.");
    return studentDataRepository.normalize(value);
  }

  function normalizeEmail(value) {
    return StudentData.normalizeEmail(value);
  }

  function isValidProfile(profile) {
    return Core.isValidProfile(profile, BRANCHES, CAREERS);
  }

  function saveState() {
    if (!state.email) return Promise.resolve(true);
    const email = state.email;
    const snapshot = storedAccountData(state);
    const save = async () => {
      if (!accountEncryptionKey) {
        updateSyncStatus("error");
        showToast("Sign in again before saving your encrypted progress.");
        return false;
      }
      updateSyncStatus("saving");
      try {
        const encrypted = await Security.encryptAccountData(snapshot, accountEncryptionKey);
        await apiRequest("/api/state", { method: "PUT", body: encrypted });
        lastSavedState = snapshot;
        updateSyncStatus("saved");
        return true;
      } catch (error) {
        Logger.error("state.sync_failed", error);
        if (state.email === email) state = { email, activeCourse: null, ...lastSavedState };
        updateSyncStatus("error");
        showToast(error.message || "Progress could not be encrypted or synced to the server.");
        return false;
      }
    };
    const operation = accountSaveQueue.then(save, save);
    accountSaveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function activateAccount(email, data = defaultState()) {
    state = {
      email,
      activeCourse: null,
      ...storedAccountData(data)
    };
    Logger.info("account.activated");
  }

  function streakMarkup() {
    return Ui.renderDailyStreak(activityTracker.streakSummary());
  }

  function progressChartMarkup(totalCredits) {
    return Ui.renderProgressChart(state.progressHistory, totalCredits);
  }

  async function decryptAccountData(account, key) {
    try {
      return storedAccountData(await Security.decryptAccountData(account, key));
    } catch (error) {
      Logger.error("account.data_decryption_failed", error);
      throw new Error("Saved account data could not be decrypted. It may be damaged; your data has not been changed.");
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
  }

  function updateSyncStatus(nextStatus) {
    syncStatus = nextStatus;
    const indicator = document.getElementById("sync-status");
    if (!indicator) return;
    const labels = {
      saved: "All changes saved",
      saving: "Saving changes",
      error: "Changes not synced"
    };
    indicator.dataset.state = nextStatus;
    const label = indicator.querySelector(".sync-status-label");
    if (label) label.textContent = labels[nextStatus] || labels.error;
  }

  function guardAsyncAction(label, action) {
    return event => {
      Promise.resolve().then(() => action(event)).catch(error => {
        const eventName = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        Logger.error(`ui.${eventName}_failed`, error);
        showToast(error.message || "This action could not be completed. Please review and retry.");
      });
    };
  }

  function getRoute() {
    const match = window.location.hash.match(/^#\/(dashboard|catalog|mock-test|interview-prep|resume|mock-interview|assessment|advisor-audit|jobs|profile|edit-profile|settings|course\/([A-Z0-9]+))$/);
    return match ? { page: match[1].startsWith("course/") ? "course" : match[1], code: match[2] || null } : { page: "dashboard", code: null };
  }

  function go(route) {
    const nextHash = `#/${route}`;
    if (window.location.hash === nextHash) {
      render();
      return;
    }
    window.location.hash = `/${route}`;
  }

  function getCoursesForProfile() {
    return Core.getCoursesForProfile(state.profile, COURSES, BRANCH_CODES, CAREER_CODES, SHARED_CODES);
  }

  function getRoadmap() {
    return Core.buildRoadmap(state.profile, getCoursesForProfile(), state.completed);
  }

  function prerequisitesMet(course) {
    const completed = new Set(state.completed);
    return course.prerequisites.every(code => completed.has(code));
  }

  function courseStatus(course) {
    if (state.completed.includes(course.code)) return "completed";
    if (state.enrolled.includes(course.code)) return "progress";
    return prerequisitesMet(course) ? "available" : "locked";
  }

  function statusLabel(status) {
    return ({ completed: "Completed", progress: "In progress", available: "Available", locked: "Locked" })[status];
  }

  function statusMarkup(status) {
    return `<span class="status status-${status}"><span class="status-dot" aria-hidden="true"></span>${statusLabel(status)}</span>`;
  }

  function codingGuidance() {
    if (state.profile.coding === "None") return "Start with Programming Fundamentals before taking Data Structures.";
    if (state.profile.coding === "Beginner") return "Build confidence in Programming Fundamentals before progressing to Data Structures.";
    return "Self-reported experience does not replace transcript prerequisites. Confirm course equivalency with your advisor.";
  }

  function prerequisiteText(course) {
    if (!course.prerequisites.length) return "No prerequisites";
    return course.prerequisites.join(", ");
  }

  function courseActions(course, status) {
    const code = escapeHtml(course.code);
    const details = `<button class="text-button" type="button" data-action="details" data-code="${code}">Details</button>`;
    if (status === "available") return `${details}<button class="button button-primary small-button" type="button" data-action="enroll" data-code="${code}">Enroll</button>`;
    if (status === "progress") return `${details}<button class="button button-secondary small-button" type="button" data-action="complete" data-code="${code}">Mark Complete</button>`;
    if (status === "locked") return `${details}<span class="lock-note">Prerequisites not met</span>`;
    return details;
  }

  function courseCard(course) {
    const status = courseStatus(course);
    return `<article class="course-card" data-course-code="${escapeHtml(course.code)}">
      <div class="course-card-main">
        <div class="course-card-info">
          <div class="course-code-row"><div class="course-code">${escapeHtml(course.code)} · ${course.credits} credits</div>${statusMarkup(status)}</div>
          <h3 class="course-title">${escapeHtml(course.name)}</h3>
          <p class="course-description">${escapeHtml(course.description)}</p>
          <div class="course-meta-row"><span>Prerequisites: ${escapeHtml(prerequisiteText(course))}</span><span>${escapeHtml(course.difficulty)}</span></div>
        </div>
        <div class="course-card-actions">${courseActions(course, status)}</div>
      </div>
    </article>`;
  }

  function footerLinks(className = "footer-inline") {
    return `<footer class="${className}"><a href="./privacy.html">Privacy Policy</a><a href="./terms.html">Terms &amp; Conditions</a></footer>`;
  }

  async function localDataForMigration(email, password) {
    const account = authAccounts[email];
    if (!account) return null;
    const passwordHash = await Security.hashPassword(password, account.salt);
    if (passwordHash !== account.passwordHash) {
      throw new Error("The password does not match the saved account on this browser.");
    }
    if (!account.encryptedData) return account.data || defaultState();
    const oldKey = await Security.deriveEncryptionKey(password, account.dataSalt);
    return decryptAccountData(account, oldKey);
  }

  function removeMigratedLocalData(email, removeUnassignedLegacy = false) {
    try {
      legacyStudent = studentDataRepository.removeMigratedData(
        authAccounts, email, legacyStudent, removeUnassignedLegacy
      );
    } catch (error) {
      Logger.error("student_data.migration_cleanup_failed", error);
      showToast("Your account is active, but an older browser-stored copy could not be removed.");
    }
  }

  function renderLanding() {
    const creatingAccount = authMode === "signup";
    app.innerHTML = `<main class="signin-only-page">
      <section class="landing-signin" aria-labelledby="signin-heading">
        <div class="auth-brand"><span class="logo-image-crop auth-logo-crop"><img src="./pathwise-logo.jpg" alt="Pathwise" draggable="false"></span></div>
        <h1 id="signin-heading">${creatingAccount ? "Create account" : "Welcome back"}</h1>
        <p class="auth-subtitle">${creatingAccount ? "Create your Pathwise account" : "Sign in to your account"}</p>
        <form id="login-form" novalidate>
          <div class="form-field"><label for="login-email">Email</label><input class="field-control" id="login-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escapeHtml(emailDraft)}" aria-describedby="auth-error" required></div>
          <div class="form-field password-field">
            <div class="auth-label-row"><label for="login-password">Password</label>${creatingAccount ? "" : `<span class="auth-unavailable" title="Password recovery is not configured.">Reset unavailable</span>`}<button class="auth-text-button" type="button" data-action="toggle-password" data-target="login-password" aria-controls="login-password" aria-pressed="false">Show</button></div>
            <input class="field-control" id="login-password" name="password" type="password" autocomplete="${creatingAccount ? "new-password" : "current-password"}" minlength="8" maxlength="128" aria-describedby="auth-error" required>
            ${creatingAccount ? `<p class="form-help">Use at least 8 characters.</p>` : ""}
          </div>
          ${creatingAccount ? `<div class="form-field password-field"><div class="auth-label-row"><label for="confirm-password">Confirm password</label><button class="auth-text-button" type="button" data-action="toggle-password" data-target="confirm-password" aria-controls="confirm-password" aria-pressed="false">Show</button></div><input class="field-control" id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" aria-describedby="auth-error" required></div>` : ""}
          <p class="form-error" id="auth-error" role="alert"></p>
          <button class="button button-primary signin-button" type="submit">${creatingAccount ? "Create account" : "Sign in"}</button>
        </form>
        <div class="signin-divider"><span>or</span></div>
        <button class="button button-secondary google-button" type="button" disabled aria-describedby="signin-disclaimer"><span class="google-mark" aria-hidden="true">G</span>Google sign-in unavailable</button>
        <p class="signin-disclaimer" id="signin-disclaimer">${creatingAccount ? "Email sign-in is available. Google sign-in, email verification, and password reset are not configured." : "Encrypted progress syncs through your account. Google sign-in, email verification, and password reset are not configured."}</p>
        <p class="auth-switch-copy">${creatingAccount ? "Already have an account?" : "Need an account?"} <button class="auth-mode-link" type="button" data-auth-mode="${creatingAccount ? "login" : "signup"}">${creatingAccount ? "Sign in" : "Sign up"}</button></p>
      </section>
    </main>`;
    const emailInput = document.getElementById("login-email");
    const form = document.getElementById("login-form");
    const error = document.getElementById("auth-error");
    const authFields = [...form.querySelectorAll("input")];
    const clearAuthError = () => {
      error.textContent = "";
      error.classList.remove("visible");
      authFields.forEach(field => field.removeAttribute("aria-invalid"));
    };
    emailInput.addEventListener("input", () => {
      emailDraft = emailInput.value;
      clearAuthError();
    });
    authFields.slice(1).forEach(field => field.addEventListener("input", clearAuthError));
    document.querySelectorAll("[data-auth-mode]").forEach(button => {
      button.addEventListener("click", () => {
        emailDraft = emailInput.value;
        authMode = button.dataset.authMode;
        renderLanding();
      });
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (authSubmitting) return;
      const data = new FormData(event.currentTarget);
      const email = normalizeEmail(data.get("email"));
      const password = String(data.get("password") || "");
      const passwordInput = document.getElementById("login-password");
      const confirmInput = document.getElementById("confirm-password");
      const reportError = (message, field) => {
        error.textContent = message;
        error.classList.add("visible");
        if (field) {
          field.setAttribute("aria-invalid", "true");
          field.focus();
        }
      };
      if (!email) {
        reportError("Enter a valid email address.", emailInput);
        return;
      }
      emailDraft = email;
      if (password.length < 8) {
        reportError("Use a password with at least 8 characters.", passwordInput);
        return;
      }
      if (creatingAccount && password !== String(data.get("confirmPassword") || "")) {
        reportError("The passwords do not match.", confirmInput);
        return;
      }

      authSubmitting = true;
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
      submitButton.textContent = creatingAccount ? "Creating account…" : "Signing in…";
      clearAuthError();
      try {
        let remoteAccount;
        let accountData = null;
        if (creatingAccount) {
          accountData = await localDataForMigration(email, password);
          if (!accountData && legacyStudent &&
              (legacyStudent.email === email || (!legacyStudent.email && Object.keys(authAccounts).length === 0))) {
            accountData = storedAccountData(legacyStudent);
          }
          remoteAccount = await apiRequest("/api/auth/register", {
            method: "POST",
            body: { email, password }
          });
        } else {
          try {
            remoteAccount = await apiRequest("/api/auth/login", {
              method: "POST",
              body: { email, password }
            });
          } catch (loginError) {
            if (loginError.status !== 401 || !authAccounts[email]) throw loginError;
            accountData = await localDataForMigration(email, password);
            try {
              remoteAccount = await apiRequest("/api/auth/register", {
                method: "POST",
                body: { email, password }
              });
            } catch (registerError) {
              if (registerError.status === 409) throw loginError;
              throw registerError;
            }
          }
        }

        accountEncryptionKey = await Security.deriveEncryptionKey(password, remoteAccount.dataSalt);
        if (remoteAccount.encryptedData) {
          accountData = await decryptAccountData(remoteAccount, accountEncryptionKey);
        }
        activateAccount(email, accountData || defaultState());
        lastSavedState = storedAccountData(state);
        if (!remoteAccount.encryptedData && !await saveState()) {
          accountEncryptionKey = null;
          state = defaultState();
          reportError("The account was created, but its initial data did not sync. Sign in and try again.");
          return;
        }
        const matchingLegacyStudent = legacyStudent &&
          (legacyStudent.email === email || (!legacyStudent.email && Object.keys(authAccounts).length === 0));
        if (accountData && (authAccounts[email] || matchingLegacyStudent)) {
          removeMigratedLocalData(email, Boolean(matchingLegacyStudent && !legacyStudent.email));
        }

        if (state.profile) go("dashboard");
        else renderOnboarding();
      } catch (authError) {
        accountEncryptionKey = null;
        Logger.error("account.sign_in_failed", authError);
        reportError(authError.message || "Sign-in could not be completed.");
      } finally {
        authSubmitting = false;
        if (submitButton.isConnected) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
          submitButton.textContent = creatingAccount ? "Create account" : "Sign in";
        }
      }
    });
  }

  function renderOnboarding() {
    app.innerHTML = `<div class="onboarding-shell">
      <aside class="onboarding-aside">
        <a class="brand" href="./index.html"><span class="logo-image-crop brand-logo-crop"><img src="./pathwise-logo.jpg" alt="Pathwise" draggable="false"></span></a>
        <div class="onboarding-aside-copy">
          <p class="eyebrow">ENGINEERING / COURSE PLANNER</p>
          <h1>Plan your next courses with prerequisites in view.</h1>
          <p>Set your branch, semester, coding experience, and career direction. Pathwise builds a course sequence you can review and track.</p>
        </div>
        <div class="onboarding-aside-foot">Your student data is encrypted before it is synced to your account.</div>
      </aside>
      <main class="onboarding-form-wrap">
        <form class="onboarding-form" id="diagnostic-form" novalidate>
          <p class="eyebrow">STUDENT PROFILE / 01</p>
          <h2>Build your roadmap</h2>
          <p>Choose your current context. You can update it later.</p>
          <div class="form-grid">
            <div class="form-field"><label for="branch">Engineering branch</label><select class="field-control" id="branch" name="branch" required><option value="">Select a branch</option>${BRANCHES.map(branch => `<option>${escapeHtml(branch)}</option>`).join("")}</select></div>
            <div class="form-field"><label for="semester">Current semester</label><select class="field-control" id="semester" name="semester" required><option value="">Select a semester</option>${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">Semester ${index + 1}</option>`).join("")}</select><div class="form-help">Courses you have not completed remain visible until you mark them complete.</div></div>
            <div class="form-field"><label for="coding">Prior coding knowledge</label><select class="field-control" id="coding" name="coding" required><option value="">Select a level</option><option>None</option><option>Beginner</option><option>Intermediate</option></select></div>
            <div class="form-field"><label for="goal">Career target</label><select class="field-control" id="goal" name="goal" required><option value="">Select a career target</option>${CAREERS.map(goal => `<option>${escapeHtml(goal)}</option>`).join("")}</select></div>
          </div>
          <p class="form-error" id="form-error" role="alert"></p>
          <div class="form-actions"><span class="form-legal">By continuing, you agree to our <a href="./terms.html">Terms</a> and <a href="./privacy.html">Privacy Policy</a>.</span><button class="button button-primary" type="submit">Start Roadmap</button></div>
          ${state.profile ? `<button class="button button-quiet" style="margin-top:12px" type="button" data-action="back-dashboard">Return to saved roadmap</button>` : ""}
          <button class="button button-quiet" style="margin-top:8px" type="button" data-action="sign-out">Sign out</button>
          ${footerLinks()}
        </form>
      </main>
    </div>`;
    const form = document.getElementById("diagnostic-form");
    form.addEventListener("submit", guardAsyncAction("diagnostic save", async event => {
      event.preventDefault();
      const data = new FormData(form);
      const profile = {
        branch: String(data.get("branch") || ""),
        semester: Number(data.get("semester")),
        coding: String(data.get("coding") || ""),
        goal: String(data.get("goal") || "")
      };
      if (!isValidProfile(profile)) {
        const error = document.getElementById("form-error");
        error.textContent = "Complete each field to build your roadmap.";
        error.classList.add("visible");
        return;
      }
      const includedCodes = new Set(Core.getCoursesForProfile(
        profile, COURSES, BRANCH_CODES, CAREER_CODES, SHARED_CODES
      ).map(course => course.code));
      const completed = state.completed.filter(code => includedCodes.has(code));
      const enrolled = state.enrolled.filter(code => includedCodes.has(code));
      await apiRequest("/api/advisor-audit", {
        method: "POST",
        body: { profile, completed, enrolled }
      });
      const roadmapChanged = !state.profile || state.profile.branch !== profile.branch ||
        state.profile.semester !== profile.semester || state.profile.goal !== profile.goal;
      state.profile = profile;
      state.completed = completed;
      state.enrolled = enrolled;
      if (roadmapChanged) {
        state.progressHistory = [];
        catalogFilters = { search: "", semester: "", difficulty: "", status: "" };
      }
      recordProgressSnapshot();
      if (!await saveState()) return;
      go("dashboard");
    }));
  }

  function shell(content, page) {
    const profileName = state.resume.fullName || state.profile.branch;
    const syncLabels = { saved: "All changes saved", saving: "Saving changes", error: "Changes not synced" };
    const syncLabel = syncLabels[syncStatus] || syncLabels.error;
    const workspaceItems = [
      { route: "dashboard", label: "Roadmaps", icon: "⌂" },
      { route: "catalog", label: "Courses", icon: "▦" },
      { route: "mock-test", label: "Mock test", icon: "▤" },
      { route: "interview-prep", label: "Interview prep", icon: "◇" },
      { route: "resume", label: "Resume prep", icon: "▧" },
      { route: "mock-interview", label: "Mock interview", icon: "◷" },
      { route: "assessment", label: "Assessment", icon: "▣" },
      { route: "advisor-audit", label: "Advisor Audit", icon: "✓" },
      { route: "jobs", label: "Jobs", icon: "↗" }
    ];
    const accountItems = [
      { route: "profile", label: "My profile", icon: "profile" },
      { route: "edit-profile", label: "Edit profile", icon: "edit" },
      { route: "settings", label: "Settings", icon: "settings" }
    ];
    const navIconMarkup = icon => {
      const icons = {
        profile: `<svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.5 20c.7-3.8 3.3-5.8 7.5-5.8s6.8 2 7.5 5.8"></path></svg>`,
        edit: `<svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="m16.5 3.5 4 4L9 19l-5 1 1-5z"></path></svg>`,
        settings: `<svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"></circle><path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9 5.5 5.5"></path></svg>`
      };
      return icons[icon] || `<span class="nav-icon" aria-hidden="true">${icon}</span>`;
    };
    const navLinks = items => items.map(item =>
      `<a class="nav-link" href="#/${item.route}" ${page === item.route ? 'aria-current="page"' : ""}>${navIconMarkup(item.icon)}${item.label}</a>`
    ).join("");
    const workspaceNav = navLinks(workspaceItems);
    const accountNav = navLinks(accountItems);
    const mobileQuickLinks = ["dashboard", "catalog", "assessment"].map(route => {
      const item = workspaceItems.find(entry => entry.route === route);
      return `<a class="nav-link" href="#/${route}" ${page === route ? 'aria-current="page"' : ""}>${navIconMarkup(item.icon)}${item.label}</a>`;
    }).join("");
    app.innerHTML = `<div class="app-shell">
      <a class="skip-link" href="#main-content">Skip to content</a>
      <aside class="sidebar">
        <a class="brand" href="#/dashboard"><span class="logo-image-crop brand-logo-crop"><img src="./pathwise-logo.jpg" alt="Pathwise" draggable="false"></span></a>
        <p class="nav-label">Catalog</p>
        <nav class="primary-nav" aria-label="Workspace">${workspaceNav}</nav>
        <p class="nav-label account-nav-label">Account</p>
        <nav class="primary-nav" aria-label="Account">${accountNav}</nav>
        <div class="sidebar-spacer"></div>
        <div class="profile-mini"><span class="avatar" aria-hidden="true">${escapeHtml(profileName.split(" ").map(word => word[0]).slice(0, 2).join(""))}</span><div><div class="profile-mini-name">${escapeHtml(profileName)}</div><div class="profile-mini-sub">${escapeHtml(state.profile.branch)} · Sem ${state.profile.semester}</div></div></div>
        <div class="sidebar-footer"><a href="./privacy.html">Privacy</a><a href="./terms.html">Terms</a><button class="text-button signout-link" type="button" data-action="sign-out">Sign out</button></div>
      </aside>
      <div class="main-shell">
        <header class="topbar"><a class="brand mobile-brand" href="#/dashboard"><span class="logo-image-crop mobile-logo-crop"><img src="./pathwise-logo.jpg" alt="Pathwise" draggable="false"></span></a><div class="breadcrumb">Workspace <span aria-hidden="true">/</span> <strong>${pageTitle(page)}</strong></div><div class="topbar-right" id="sync-status" data-state="${escapeHtml(syncStatus)}" role="status" aria-live="polite"><span class="topbar-dot" aria-hidden="true"></span><span class="sync-status-label">${syncLabel}</span></div><button class="mobile-menu-toggle" type="button" data-action="toggle-mobile-menu" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-menu">${mobileMenuOpen ? "Close" : "Menu"}</button></header>
        <main class="content" id="main-content" tabindex="-1">${content}</main>
      </div>
      <nav class="mobile-nav" aria-label="Quick navigation">${mobileQuickLinks}<button class="nav-link mobile-more" type="button" data-action="toggle-mobile-menu" aria-expanded="${mobileMenuOpen}" aria-controls="mobile-menu"><span class="nav-icon" aria-hidden="true">···</span>More</button></nav>
      <nav id="mobile-menu" class="mobile-drawer ${mobileMenuOpen ? "is-open" : ""}" aria-label="All workspace pages">${workspaceNav}<p class="nav-label account-nav-label">Account</p>${accountNav}<a class="nav-link" href="./privacy.html">Privacy</a><a class="nav-link" href="./terms.html">Terms</a><button class="nav-link drawer-signout" type="button" data-action="sign-out">Sign out</button></nav>
    </div>`;
    document.querySelector(".skip-link").addEventListener("click", event => {
      event.preventDefault();
      document.getElementById("main-content").focus();
    });
  }

  function pageTitle(page) {
    return ({
      dashboard: "Roadmaps", catalog: "Courses", course: "Course details", "mock-test": "Mock test",
      "interview-prep": "Interview prep", resume: "Resume prep", "mock-interview": "Mock interview",
      assessment: "Assessment", "advisor-audit": "Advisor Audit", jobs: "Jobs & pathways", profile: "My profile",
      "edit-profile": "Edit profile", settings: "Settings"
    })[page] || "Roadmaps";
  }

  function dashboard() {
    const roadmap = getRoadmap();
    const totalCredits = roadmap.reduce((sum, course) => sum + course.credits, 0);
    const completeCredits = roadmap.filter(course => state.completed.includes(course.code)).reduce((sum, course) => sum + course.credits, 0);
    const percent = totalCredits ? Math.round((completeCredits / totalCredits) * 100) : 0;
    const remaining = roadmap.filter(course => !state.completed.includes(course.code)).length;
    const available = roadmap.find(course => courseStatus(course) === "available");
    const terms = new Map();
    for (const course of roadmap) {
      const term = course.roadmapSemester;
      if (!terms.has(term)) terms.set(term, []);
      terms.get(term).push(course);
    }
    const termMarkup = [...terms.entries()].sort((a, b) => a[0] - b[0]).map(([semester, courses]) =>
      `<section><div class="roadmap-term-header"><h3>Semester ${semester}${semester === state.profile.semester ? " · Current" : ""}</h3><span>${courses.filter(course => state.completed.includes(course.code)).length} / ${courses.length} complete</span></div><div class="term-courses">${courses.map(courseCard).join("")}</div></section>`
    ).join("");
    const careerPlanMarkup = YEAR_ROADMAP.map(year => `<article class="career-year-card"><div class="career-year-heading"><span class="meta">YEAR ${year.year}</span><h3>${escapeHtml(year.title)}</h3></div><ul class="task-list">${year.tasks.map((task, index) => {
      const taskId = `year-${year.year}-${index + 1}`;
      const checked = state.roadmapTasks.includes(taskId);
      return `<li><label class="task-item"><input type="checkbox" data-action="toggle-roadmap-task" data-code="${escapeHtml(taskId)}" ${checked ? "checked" : ""}><span>${escapeHtml(task)}</span></label></li>`;
    }).join("")}</ul></article>`).join("");
    const content = `<div class="page-heading"><div><p class="eyebrow">ACADEMIC PLAN</p><h1>Your roadmap</h1><p>${escapeHtml(state.profile.branch)} · Semester ${state.profile.semester} · ${escapeHtml(state.profile.goal)}</p></div><div class="heading-actions"><a class="button button-secondary" href="#/advisor-audit">Advisor Audit</a><button class="button button-secondary" type="button" data-action="edit-profile">Edit profile</button></div></div>
      <section class="overview-grid" aria-label="Progress overview">
        <div class="stat-card"><div class="stat-label">Credits completed</div><div class="stat-value">${completeCredits}<span style="color:var(--muted);font-size:14px"> / ${totalCredits}</span></div><div class="stat-note">Across recommended courses</div></div>
        <div class="stat-card"><div class="stat-label">Roadmap complete</div><div class="stat-value">${percent}%</div><div class="stat-note">By credits completed</div></div>
        <div class="stat-card"><div class="stat-label">Courses remaining</div><div class="stat-value">${remaining}</div><div class="stat-note">Completed courses excluded</div></div>
        <div class="stat-card"><div class="stat-label">Available now</div><div class="stat-value">${roadmap.filter(course => courseStatus(course) === "available").length}</div><div class="stat-note">Prerequisites are complete</div></div>
      </section>
      ${streakMarkup()}
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-header"><h2>Semester-by-semester plan</h2><a class="panel-link" href="#/catalog">Browse catalog →</a></div><div class="panel-body"><div class="roadmap">${termMarkup || '<div class="empty-state"><h2>No courses found</h2><p>Update your profile to generate a roadmap.</p></div>'}</div></div></section>
        <aside class="panel"><div class="panel-header"><h2>Progress</h2><span class="meta">${percent}%</span></div><div class="panel-body">
          <div class="progress-track" role="progressbar" aria-label="Course progress" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${percent}%"></div></div>
          <div class="progress-row"><span>Credits completed</span><strong>${completeCredits} / ${totalCredits}</strong></div>
          <div class="progress-row"><span>Courses completed</span><strong>${roadmap.length - remaining} / ${roadmap.length}</strong></div>
          <div class="progress-graph-card glass-panel"><div class="progress-graph-heading"><span class="meta">CREDITS OVER TIME</span><span class="chart-legend"><i aria-hidden="true"></i>Completed</span></div>${progressChartMarkup(totalCredits)}</div>
          <div class="goal-block"><div class="meta">CAREER TARGET</div><p>${escapeHtml(state.profile.goal)}</p><div class="meta" style="margin-top:12px">CODING LEVEL / ${escapeHtml(state.profile.coding)}</div><p class="goal-guidance">${escapeHtml(codingGuidance())}</p></div>
          <div class="next-course"><div class="meta">NEXT AVAILABLE COURSE</div>${available ? `<h3 class="next-course-title">${escapeHtml(available.name)}</h3><p>${escapeHtml(available.code)} · ${available.credits} credits</p><div style="margin-top:10px"><button class="button button-primary small-button" type="button" data-action="enroll" data-code="${escapeHtml(available.code)}">Enroll</button></div>` : `<p class="next-course-title">No courses available</p><p>Complete an enrolled course to unlock the next step.</p>`}</div>
        </div></aside>
      </div>
      <section class="panel career-roadmap-panel"><div class="panel-header"><div><h2>Four-year career plan</h2><p class="panel-subtitle">A flexible checklist adapted from the provided B.Tech roadmap. Adjust it to your institution and goals.</p></div></div><div class="career-year-grid">${careerPlanMarkup}</div></section>`;
    shell(content, "dashboard");
  }

  function catalog() {
    const courses = getRoadmap();
    const semesters = [...new Set(courses.map(course => course.roadmapSemester))].sort((a, b) => a - b);
    const content = `<div class="page-heading"><div><p class="eyebrow">COURSE DIRECTORY</p><h1>Course catalog</h1><p>Search your recommended courses and check prerequisite status before enrolling.</p></div></div>
      <section class="panel">
        <div class="filters">
          <input class="field-control" id="course-search" type="search" placeholder="Search name, code, keyword" aria-label="Search courses">
          <select class="field-control" id="semester-filter" aria-label="Filter by semester"><option value="">All semesters</option>${semesters.map(semester => `<option value="${semester}">Semester ${semester}</option>`).join("")}</select>
          <select class="field-control" id="difficulty-filter" aria-label="Filter by difficulty"><option value="">All difficulties</option><option>Introductory</option><option>Intermediate</option><option>Advanced</option></select>
          <select class="field-control" id="status-filter" aria-label="Filter by status"><option value="">All statuses</option><option value="completed">Completed</option><option value="progress">In progress</option><option value="available">Available</option><option value="locked">Locked</option></select>
        </div>
        <div class="catalog-summary" id="catalog-summary" aria-live="polite">${courses.length} recommended courses</div>
        <div class="catalog-grid" id="catalog-grid">${courses.map(courseCard).join("")}</div>
      </section>`;
    shell(content, "catalog");
    const search = document.getElementById("course-search");
    const semester = document.getElementById("semester-filter");
    const difficulty = document.getElementById("difficulty-filter");
    const status = document.getElementById("status-filter");
    search.value = catalogFilters.search;
    semester.value = catalogFilters.semester;
    difficulty.value = catalogFilters.difficulty;
    status.value = catalogFilters.status;
    const renderFiltered = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = courses.filter(course => {
        const searchable = `${course.name} ${course.code} ${course.description} ${course.keywords.join(" ")}`.toLowerCase();
        return (!query || searchable.includes(query)) &&
          (!semester.value || course.roadmapSemester === Number(semester.value)) &&
          (!difficulty.value || course.difficulty === difficulty.value) &&
          (!status.value || courseStatus(course) === status.value);
      });
      document.getElementById("catalog-summary").textContent = `${filtered.length} of ${courses.length} recommended courses`;
      document.getElementById("catalog-grid").innerHTML = filtered.length ? filtered.map(courseCard).join("") : `<div class="empty-state"><h2>No matching courses</h2><p>Change or clear your filters and try again.</p><button class="button button-secondary" type="button" data-action="clear-course-filters">Clear filters</button></div>`;
    };
    const filterKeys = ["search", "semester", "difficulty", "status"];
    [search, semester, difficulty, status].forEach((field, index) => field.addEventListener("input", () => {
      catalogFilters[filterKeys[index]] = field.value;
      renderFiltered();
    }));
    renderFiltered();
  }

  function courseDetail(code) {
    const course = getRoadmap().find(item => item.code === code);
    if (!course) {
      go("catalog");
      showToast("That course is not in your current roadmap.");
      return;
    }
    const status = courseStatus(course);
    const prereqMarkup = course.prerequisites.length
      ? course.prerequisites.map(prereq => `<span class="prereq-chip">${escapeHtml(prereq)} · ${state.completed.includes(prereq) ? "Complete" : "Incomplete"}</span>`).join("")
      : `<span class="prereq-chip">No prerequisites</span>`;
    const content = `<div class="page-heading"><div><p class="eyebrow">COURSE DETAILS</p><h1>Course overview</h1><p>Review the course requirements and current enrollment status.</p></div><a class="button button-secondary" href="#/catalog">Back to catalog</a></div>
      <article class="detail-card">
        <div class="detail-top"><div><div class="course-code">${escapeHtml(course.code)}</div><h2 class="detail-title">${escapeHtml(course.name)}</h2><p class="detail-description">${escapeHtml(course.description)}</p></div>${statusMarkup(status)}</div>
        <div class="detail-facts"><div class="detail-fact"><div class="meta">Credits</div><strong>${course.credits}</strong></div><div class="detail-fact"><div class="meta">Recommended</div><strong>Semester ${course.roadmapSemester}</strong></div><div class="detail-fact"><div class="meta">Difficulty</div><strong>${escapeHtml(course.difficulty)}</strong></div></div>
        <section class="detail-section"><h3>Prerequisites</h3><div class="prereq-list">${prereqMarkup}</div>${status === "locked" ? `<p class="lock-note" style="margin-top:8px">Prerequisites not met. Complete the listed courses to unlock enrollment.</p>` : ""}</section>
        <section class="detail-section"><h3>Course keywords</h3><div class="prereq-list">${course.keywords.map(keyword => `<span class="prereq-chip">${escapeHtml(keyword)}</span>`).join("")}</div></section>
        <div class="detail-actions">${courseActions(course, status)}</div>
      </article>`;
    shell(content, "course");
  }

  function editProfilePage() {
    const content = `    <div class="page-heading"><div><p class="eyebrow">PROFILE SETTINGS</p><h1>Edit profile</h1><p>Change these details to recalculate your recommended course sequence. Account: ${escapeHtml(state.email)}.</p></div></div>
      <form class="detail-card" id="profile-form" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="branch">Engineering branch</label><select class="field-control" id="branch" name="branch" required>${BRANCHES.map(branch => `<option ${branch === state.profile.branch ? "selected" : ""}>${escapeHtml(branch)}</option>`).join("")}</select></div>
          <div class="form-field"><label for="semester">Current semester</label><select class="field-control" id="semester" name="semester" required>${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${index + 1 === state.profile.semester ? "selected" : ""}>Semester ${index + 1}</option>`).join("")}</select></div>
          <div class="form-field"><label for="coding">Prior coding knowledge</label><select class="field-control" id="coding" name="coding" required>${["None", "Beginner", "Intermediate"].map(level => `<option ${level === state.profile.coding ? "selected" : ""}>${level}</option>`).join("")}</select></div>
          <div class="form-field"><label for="goal">Career target</label><select class="field-control" id="goal" name="goal" required>${CAREERS.map(goal => `<option ${goal === state.profile.goal ? "selected" : ""}>${escapeHtml(goal)}</option>`).join("")}</select></div>
        </div>
        <p class="form-error" id="form-error" role="alert"></p>
        <div class="detail-actions"><button class="button button-primary" type="submit">Save changes</button><button class="button button-secondary" type="button" data-action="reset-progress">Clear progress</button><button class="button button-quiet" type="button" data-action="sign-out">Sign out</button></div>
      </form>`;
    shell(content, "edit-profile");
    document.getElementById("profile-form").addEventListener("submit", guardAsyncAction("profile save", async event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const next = { branch: String(formData.get("branch")), semester: Number(formData.get("semester")), coding: String(formData.get("coding")), goal: String(formData.get("goal")) };
      if (!isValidProfile(next)) {
        const error = document.getElementById("form-error");
        error.textContent = "Choose a valid value for each field.";
        error.classList.add("visible");
        return;
      }
      const includedCodes = new Set(Core.getCoursesForProfile(
        next, COURSES, BRANCH_CODES, CAREER_CODES, SHARED_CODES
      ).map(course => course.code));
      const completed = state.completed.filter(code => includedCodes.has(code));
      const enrolled = state.enrolled.filter(code => includedCodes.has(code));
      await apiRequest("/api/advisor-audit", {
        method: "POST",
        body: { profile: next, completed, enrolled }
      });
      const roadmapChanged = state.profile.branch !== next.branch ||
        state.profile.semester !== next.semester || state.profile.goal !== next.goal;
      state.profile = next;
      state.completed = completed;
      state.enrolled = enrolled;
      if (roadmapChanged) {
        state.progressHistory = [];
        catalogFilters = { search: "", semester: "", difficulty: "", status: "" };
      }
      recordProgressSnapshot();
      if (!await saveState()) return;
      Logger.info("student_profile.updated");
      showToast("Profile and roadmap updated.");
      go("dashboard");
    }));
  }

  function profilePage() {
    const projectEntries = state.resume.projects.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const fullName = state.resume.fullName || "Student";
    const initials = fullName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
    const about = state.resume.summary || "Add a short professional summary in Resume Prep.";
    const content = `<div class="page-heading"><div><p class="eyebrow">STUDENT PROFILE</p><h1>My profile</h1><p>Your profile and progress are encrypted before server sync. This profile is not public.</p></div><div class="heading-actions"><button class="button button-secondary" type="button" data-action="copy-profile">Copy summary</button><a class="button button-secondary" href="#/edit-profile">Edit profile</a><a class="button button-primary" href="#/resume">Resume prep</a></div></div>
      <section class="profile-overview panel">
        <div class="profile-identity"><span class="avatar profile-avatar" aria-hidden="true">${escapeHtml(initials || "S")}</span><div><h2>${escapeHtml(fullName)}</h2><p>${escapeHtml(state.profile.branch)} · Semester ${state.profile.semester} · ${escapeHtml(state.profile.goal)}</p><span class="meta">${escapeHtml(state.email)}</span></div></div>
        <div class="profile-counts"><div><span class="meta">RESUME</span><strong>${state.resume.fullName || state.resume.summary ? "Draft saved" : "Not started"}</strong></div><div><span class="meta">ENROLLED COURSES</span><strong>${state.enrolled.length}</strong></div><div><span class="meta">PROJECTS</span><strong>${projectEntries.length}</strong></div></div>
      </section>
      <div class="profile-content-grid">
        <section class="panel"><div class="panel-header"><h2>About</h2></div><div class="panel-body"><p class="profile-copy">${escapeHtml(about)}</p><div class="profile-facts"><div><span class="meta">CAREER TARGET</span><strong>${escapeHtml(state.profile.goal)}</strong></div><div><span class="meta">CODING EXPERIENCE</span><strong>${escapeHtml(state.profile.coding)}</strong></div><div><span class="meta">LOCATION</span><strong>${escapeHtml(state.resume.location || "Not added")}</strong></div></div></div></section>
        <section class="panel"><div class="panel-header"><h2>Experience</h2></div><div class="panel-body"><p class="profile-copy">${escapeHtml(state.resume.experience || "Add internships, work, or relevant activities in Resume Prep.")}</p></div></section>
        <section class="panel"><div class="panel-header"><h2>Proof of work</h2><a class="panel-link" href="#/resume">Edit resume</a></div><div class="panel-body">${projectEntries.length ? `<ul class="plain-list">${projectEntries.map(entry => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>` : `<p class="profile-copy">Add project names and links in Resume Prep to document your work.</p>`}${state.resume.links ? `<div class="profile-links">${state.resume.links.split(/\r?\n/).filter(Boolean).map(link => `<p>${escapeHtml(link.trim())}</p>`).join("")}</div>` : ""}</div></section>
      </div>`;
    shell(content, "profile");
  }

  function mockTestPage() {
    const active = state.activeTest;
    if (active) {
      const quiz = MOCK_TESTS.find(test => test.id === active.quizId);
      if (!quiz || !Number.isInteger(active.index) || active.index < 0 || active.index >= quiz.questions.length) {
        shell(`<div class="page-heading"><div><p class="eyebrow">MOCK TEST</p><h1>Practice session unavailable</h1><p>The saved session does not match the current question set.</p></div></div><button class="button button-secondary" type="button" data-action="exit-mock-test">Return to mock tests</button>`, "mock-test");
        return;
      }
      const question = quiz.questions[active.index];
      const checked = Boolean(active.checked);
      const selectedAnswer = Number.isInteger(active.selectedAnswer) ? active.selectedAnswer : -1;
      const feedback = checked
        ? `<div class="answer-feedback"><strong>${selectedAnswer === question.answer ? "Correct" : "Review this answer"}</strong><p>${escapeHtml(question.explanation)}</p></div>`
        : "";
      const content = `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(quiz.title)} / ${escapeHtml(quiz.coverage)}</p><h1>Question ${active.index + 1} of ${quiz.questions.length}</h1><p>Practice check only. This is not an official university paper.</p></div><button class="button button-secondary" type="button" data-action="exit-mock-test">Exit test</button></div>
        <section class="detail-card quiz-card"><div class="quiz-progress-track" role="progressbar" aria-label="Test question progress" aria-valuenow="${active.index + 1}" aria-valuemin="0" aria-valuemax="${quiz.questions.length}"><span style="width:${((active.index + 1) / quiz.questions.length) * 100}%"></span></div><form id="mock-answer-form"><fieldset class="quiz-fieldset"><legend>${escapeHtml(question.prompt)}</legend>${question.choices.map((choice, index) => `<label class="quiz-choice"><input type="radio" name="answer" value="${index}" ${selectedAnswer === index ? "checked" : ""} ${checked ? "disabled" : ""} required><span>${escapeHtml(choice)}</span></label>`).join("")}</fieldset>${feedback}${checked ? `<button class="button button-primary" type="button" data-action="next-mock-question">${active.index + 1 === quiz.questions.length ? "Finish test" : "Next question"}</button>` : `<button class="button button-primary" type="submit">Check answer</button>`}</form></section>`;
      shell(content, "mock-test");
      document.getElementById("mock-answer-form").addEventListener("submit", guardAsyncAction("mock-test answer save", async event => {
        event.preventDefault();
        const answer = new FormData(event.currentTarget).get("answer");
        if (answer === null || !state.activeTest) return;
        state.activeTest.selectedAnswer = Number(answer);
        if (!Array.isArray(state.activeTest.answers)) state.activeTest.answers = [];
        state.activeTest.answers[active.index] = Number(answer);
        state.activeTest.checked = true;
        if (!await saveState()) {
          render();
          return;
        }
        render();
      }));
      return;
    }

    const history = state.mockTestResults.slice().reverse().slice(0, 5);
    const renderTests = () => {
      const filtered = MOCK_TESTS.filter(test => {
        const searchable = `${test.title} ${test.coverage} first-year engineering programming mathematics physics chemistry`.toLowerCase();
        return (!mockTestSearchQuery || searchable.includes(mockTestSearchQuery)) &&
          (!mockTestSectionFilter || test.examType === mockTestSectionFilter);
      });
      const cards = filtered.map(test => {
        const latest = state.mockTestResults.filter(result => result.quizId === test.id).slice(-1)[0];
        return `<article class="tool-card"><div class="tool-card-heading"><div><span class="meta">${escapeHtml(test.coverage)}</span><h2>${escapeHtml(test.title)}</h2></div><span class="course-code">${test.questions.length} QUESTIONS</span></div><p>First-year engineering topics with immediate explanations after each answer.</p><div class="tool-card-actions"><button class="button button-primary small-button" type="button" data-action="start-mock-test" data-code="${escapeHtml(test.id)}">Start test</button>${latest ? `<span class="meta">Last score: ${latest.score} / ${latest.total}</span>` : ""}</div></article>`;
      }).join("");
      document.getElementById("mock-test-grid").innerHTML = cards || `<div class="empty-state"><h2>No matching tests</h2><p>Change or clear your search and filter.</p></div>`;
      document.getElementById("mock-test-summary").textContent = `${filtered.length} of ${MOCK_TESTS.length} tests`;
    };
    const historyMarkup = history.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Test</th><th>Score</th><th>Completed</th></tr></thead><tbody>${history.map(result => {
      const test = MOCK_TESTS.find(item => item.id === result.quizId);
      return `<tr><td>${escapeHtml(test ? test.title : "Mock test")}</td><td>${result.score} / ${result.total}</td><td>${escapeHtml(new Date(result.completedAt).toLocaleDateString())}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="profile-copy">Completed tests will appear here after you submit one.</p>`;
    const content = `<div class="page-heading"><div><p class="eyebrow">PRACTICE</p><h1>Mock tests</h1><p>Short multiple-choice checks based on common first-year engineering topics. Scores sync with your account.</p></div></div>
      <section class="panel test-catalog"><div class="filters test-filters"><input class="field-control" id="mock-test-search" type="search" placeholder="Search tests or topics" aria-label="Search mock tests"><select class="field-control" id="mock-test-section" aria-label="Filter by exam type"><option value="">All exam types</option><option value="midterm">Midterms</option><option value="semester-end">Semester-end</option></select></div><div class="catalog-summary" id="mock-test-summary"></div><div class="tool-grid compact-tool-grid" id="mock-test-grid"></div></section>
      <section class="panel"><div class="panel-header"><h2>Recent results</h2></div><div class="panel-body">${historyMarkup}</div></section>`;
    shell(content, "mock-test");
    const search = document.getElementById("mock-test-search");
    const section = document.getElementById("mock-test-section");
    search.value = mockTestSearchQuery;
    section.value = mockTestSectionFilter;
    search.addEventListener("input", () => {
      mockTestSearchQuery = search.value.trim().toLowerCase();
      renderTests();
    });
    section.addEventListener("change", () => {
      mockTestSectionFilter = section.value;
      renderTests();
    });
    renderTests();
  }

  function interviewPrepPage() {
    const practiced = new Set(state.practicedQuestions);
    const questionCards = INTERVIEW_TOPICS.flatMap(topic => topic.questions.map((entry, index) => {
      const id = `${topic.id}-${index + 1}`;
      const searchable = `${topic.title} ${entry[0]} ${entry[1]}`.toLowerCase();
      return { id, title: topic.title, question: entry[0], guidance: entry[1], searchable };
    }));
    const renderQuestions = query => {
      const filtered = questionCards.filter(item => !query || item.searchable.includes(query));
      document.getElementById("interview-question-list").innerHTML = filtered.length ? filtered.map(item => `<article class="question-card"><div class="question-meta"><span class="meta">${escapeHtml(item.title)}</span><button class="text-button practice-toggle" type="button" data-action="toggle-practiced" data-code="${escapeHtml(item.id)}">${practiced.has(item.id) ? "Practiced" : "Mark practiced"}</button></div><h3>${escapeHtml(item.question)}</h3><details><summary>Show answer outline</summary><p>${escapeHtml(item.guidance)}</p></details></article>`).join("") : `<div class="empty-state"><h2>No matching questions</h2><p>Try a different search term.</p></div>`;
      document.getElementById("interview-search-summary").textContent = `${filtered.length} questions shown · ${practiced.size} practiced`;
    };
    const content = `<div class="page-heading"><div><p class="eyebrow">PREPARATION</p><h1>Interview prep</h1><p>Review common technical and project discussion prompts. Mark a question when you have practiced an answer.</p></div></div>
      <section class="panel"><div class="filters single-filter"><input class="field-control" id="interview-search" type="search" placeholder="Search questions or topics" aria-label="Search interview questions"></div><div class="catalog-summary" id="interview-search-summary"></div><div class="question-list" id="interview-question-list"></div></section>`;
    shell(content, "interview-prep");
    renderQuestions(interviewSearchQuery);
    document.getElementById("interview-search").value = interviewSearchQuery;
    document.getElementById("interview-search").addEventListener("input", event => {
      interviewSearchQuery = event.currentTarget.value.trim().toLowerCase();
      renderQuestions(interviewSearchQuery);
    });
  }

  function resumePage() {
    const resume = state.resume;
    const preview = `<div class="resume-preview"><header><h2>${escapeHtml(resume.fullName || "Your name")}</h2><p>${escapeHtml(resume.headline || state.profile.goal)}</p><p>${escapeHtml([resume.location, state.email].filter(Boolean).join(" · "))}</p></header>${[
      ["Summary", resume.summary], ["Education", resume.education], ["Skills", resume.skills],
      ["Experience", resume.experience], ["Projects", resume.projects], ["Links", resume.links]
    ].filter(section => section[1]).map(section => `<section><h3>${escapeHtml(section[0])}</h3><p>${escapeHtml(section[1])}</p></section>`).join("")}</div>`;
    const content = `<div class="page-heading"><div><p class="eyebrow">CAREER MATERIALS</p><h1>Resume prep</h1><p>Draft a resume from your own details. Your information is encrypted before account sync.</p></div><button class="button button-secondary" type="button" data-action="download-resume">Download .txt</button></div>
      <div class="resume-grid"><form class="detail-card resume-form" id="resume-form">
        <div class="form-grid">
          <div class="form-field"><label for="resume-name">Full name</label><input class="field-control" id="resume-name" name="fullName" maxlength="120" value="${escapeHtml(resume.fullName)}"></div>
          <div class="form-field"><label for="resume-headline">Target role or headline</label><input class="field-control" id="resume-headline" name="headline" maxlength="160" value="${escapeHtml(resume.headline)}"></div>
          <div class="form-field"><label for="resume-location">Location</label><input class="field-control" id="resume-location" name="location" maxlength="120" value="${escapeHtml(resume.location)}"></div>
          <div class="form-field"><label for="resume-skills">Skills</label><textarea class="field-control" id="resume-skills" name="skills" rows="3" maxlength="2000" placeholder="Separate skills with commas">${escapeHtml(resume.skills)}</textarea></div>
          <div class="form-field full-field"><label for="resume-summary">Summary</label><textarea class="field-control" id="resume-summary" name="summary" rows="4" maxlength="2000">${escapeHtml(resume.summary)}</textarea></div>
          <div class="form-field full-field"><label for="resume-education">Education</label><textarea class="field-control" id="resume-education" name="education" rows="3" maxlength="2000" placeholder="Degree, institution, dates, relevant coursework">${escapeHtml(resume.education)}</textarea></div>
          <div class="form-field full-field"><label for="resume-experience">Experience</label><textarea class="field-control" id="resume-experience" name="experience" rows="4" maxlength="3000">${escapeHtml(resume.experience)}</textarea></div>
          <div class="form-field full-field"><label for="resume-projects">Projects / proof of work</label><textarea class="field-control" id="resume-projects" name="projects" rows="4" maxlength="3000" placeholder="One project per line">${escapeHtml(resume.projects)}</textarea></div>
          <div class="form-field full-field"><label for="resume-links">Portfolio and professional links</label><textarea class="field-control" id="resume-links" name="links" rows="3" maxlength="2000" placeholder="One link per line">${escapeHtml(resume.links)}</textarea></div>
        </div>
        <div class="detail-actions"><button class="button button-primary" type="submit">Save resume details</button></div>
      </form><section class="panel resume-preview-panel"><div class="panel-header"><h2>Preview</h2></div><div class="panel-body">${preview}</div></section></div>`;
    shell(content, "resume");
    document.getElementById("resume-form").addEventListener("submit", guardAsyncAction("resume save", async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      for (const key of Object.keys(state.resume)) state.resume[key] = String(data.get(key) || "").trim();
      recordActivity();
      if (!await saveState()) return;
      showToast("Resume details saved to your account.");
      render();
    }));
  }

  function interviewPromptsForRole(role) {
    const lower = role.toLowerCase();
    let order = ["programming", "dsa", "systems", "projects"];
    if (lower.includes("data") || lower.includes("ai") || lower.includes("cyber")) order = ["dsa", "systems", "programming", "projects"];
    if (lower.includes("embedded") || lower.includes("power") || lower.includes("mechanical") || lower.includes("structural")) order = ["systems", "programming", "dsa", "projects"];
    return order.flatMap(id => {
      const topic = INTERVIEW_TOPICS.find(item => item.id === id);
      return topic.questions.slice(0, 2).map(question => ({ topic: topic.title, prompt: question[0] }));
    });
  }

  function mockInterviewPage() {
    const active = state.mockInterview;
    if (active) {
      const prompts = interviewPromptsForRole(active.role).slice(0, active.questionCount);
      if (!prompts.length || !Number.isInteger(active.index) || active.index < 0 || active.index >= prompts.length) {
        shell(`<div class="page-heading"><div><p class="eyebrow">PRACTICE SESSION</p><h1>Session unavailable</h1><p>The saved session details are incomplete.</p></div></div><button class="button button-secondary" type="button" data-action="exit-mock-interview">Return to mock interview</button>`, "mock-interview");
        return;
      }
      const question = prompts[active.index];
      const answer = Array.isArray(active.answers) ? String(active.answers[active.index] || "") : "";
      const content = `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(active.role)} / ${escapeHtml(active.format)}</p><h1>Question ${active.index + 1} of ${prompts.length}</h1><p>${escapeHtml(question.topic)}</p></div><button class="button button-secondary" type="button" data-action="exit-mock-interview">Save and exit</button></div>
        <section class="detail-card interview-session-card"><h2>${escapeHtml(question.prompt)}</h2><p class="profile-copy">Write a response or outline your answer. This local practice session does not record audio or video.</p><form id="mock-interview-answer"><div class="form-field"><label for="interview-answer">Your response / notes</label><textarea class="field-control" id="interview-answer" name="answer" rows="8" maxlength="5000">${escapeHtml(answer)}</textarea></div><div class="detail-actions"><button class="button button-primary" type="submit">${active.index + 1 === prompts.length ? "Finish session" : "Save answer and continue"}</button></div></form></section>`;
      shell(content, "mock-interview");
      document.getElementById("interview-answer").addEventListener("change", guardAsyncAction("interview draft save", async event => {
        if (!state.mockInterview) return;
        if (!Array.isArray(state.mockInterview.answers)) state.mockInterview.answers = [];
        state.mockInterview.answers[active.index] = event.currentTarget.value;
        if (!await saveState()) render();
      }));
      document.getElementById("mock-interview-answer").addEventListener("submit", guardAsyncAction("interview answer save", async event => {
        event.preventDefault();
        const response = String(new FormData(event.currentTarget).get("answer") || "").trim();
        if (!Array.isArray(state.mockInterview.answers)) state.mockInterview.answers = [];
        state.mockInterview.answers[active.index] = response;
        if (response) recordActivity();
        if (active.index + 1 < prompts.length) {
          state.mockInterview.index += 1;
          if (!await saveState()) {
            render();
            return;
          }
          render();
          return;
        }
        state.interviewSessions.push({
          role: active.role, format: active.format, completed: true, completedAt: new Date().toISOString(),
          answers: prompts.map((item, index) => ({ prompt: item.prompt, response: state.mockInterview.answers[index] || "" }))
        });
        state.mockInterview = null;
        if (!await saveState()) {
          render();
          return;
        }
        showToast("Mock interview saved.");
        render();
      }));
      return;
    }

    const history = state.interviewSessions.slice().reverse().slice(0, 5);
    const historyMarkup = history.length ? history.map(session => `<details class="session-history"><summary>${escapeHtml(session.role)} · ${escapeHtml(session.format || "Practice")} · ${session.completed ? "Completed" : "Saved"} · ${escapeHtml(new Date(session.completedAt).toLocaleDateString())}</summary><div>${(Array.isArray(session.answers) ? session.answers : []).map(item => `<div class="history-answer"><strong>${escapeHtml(item.prompt || "")}</strong><p>${escapeHtml(item.response || "No notes saved.")}</p></div>`).join("")}</div></details>`).join("") : `<p class="profile-copy">Completed or saved practice sessions will appear here.</p>`;
    const content = `<div class="page-heading"><div><p class="eyebrow">PRACTICE SESSION</p><h1>Mock interview</h1><p>Work through role-relevant prompts and save written answers for review. No audio or video is recorded.</p></div></div>
      <section class="detail-card mock-interview-start"><h2>Start a session</h2><form id="mock-interview-start"><div class="form-grid"><div class="form-field"><label for="interview-role">Career target</label><select class="field-control" id="interview-role" name="role">${CAREERS.map(goal => `<option ${goal === state.profile.goal ? "selected" : ""}>${escapeHtml(goal)}</option>`).join("")}</select></div><div class="form-field"><label for="interview-format">Session format</label><select class="field-control" id="interview-format" name="format"><option value="Guided · 4 questions">Guided · 4 questions</option><option value="Standard · 6 questions">Standard · 6 questions</option></select></div></div><div class="detail-actions"><button class="button button-primary" type="submit">Start mock interview</button></div></form></section>
      <section class="panel"><div class="panel-header"><h2>Recent sessions</h2></div><div class="panel-body">${historyMarkup}</div></section>`;
    shell(content, "mock-interview");
    document.getElementById("mock-interview-start").addEventListener("submit", guardAsyncAction("interview session start", async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const format = String(data.get("format") || "");
      state.mockInterview = {
        role: String(data.get("role") || ""), format,
        questionCount: format.startsWith("Guided") ? 4 : 6,
        index: 0, answers: []
      };
      if (!await saveState()) return;
      render();
    }));
  }

  function assessmentSummary(record) {
    return Core.assessmentSummary(record);
  }

  function assessmentStatusMarkup(result) {
    if (!result) return `<span class="status status-available"><span class="status-dot" aria-hidden="true"></span>Marks not entered</span>`;
    return `<span class="status status-${result.passed ? "completed" : "progress"}"><span class="status-dot" aria-hidden="true"></span>${result.passed ? "Meets example threshold" : "Review required"}</span>`;
  }

  function labAssessmentSummary(record) {
    return Core.labAssessmentSummary(record);
  }

  function assessmentPage() {
    const semesters = [1, 2];
    const semesterForms = semesters.map(semester => {
      const record = state.assessmentMarks[String(semester)] || {};
      const result = assessmentSummary(record);
      const fields = [
        ["mid1", "Mid-I", 30], ["mid2", "Mid-II", 30], ["assignment1", "Assignment 1", 5],
        ["assignment2", "Assignment 2", 5], ["viva", "Viva / presentation", 5], ["see", "Semester-end exam", 60]
      ];
      const fieldsMarkup = fields.map(([key, label, maximum]) => `<div class="form-field"><label for="sem${semester}-${key}">${label} / ${maximum}</label><input class="field-control" id="sem${semester}-${key}" name="${key}" type="number" min="0" max="${maximum}" step="0.5" value="${record[key] === undefined ? "" : escapeHtml(record[key])}" required></div>`).join("");
      return `<form class="detail-card marks-form" id="assessment-semester-${semester}" data-semester="${semester}"><div class="marks-heading"><div><p class="eyebrow">SEMESTER ${semester}</p><h2>Assessment record</h2></div>${assessmentStatusMarkup(result)}</div><div class="form-grid">${fieldsMarkup}</div>${result ? `<div class="score-summary"><div><span class="meta">CIE / 40</span><strong>${result.cie.toFixed(1)}</strong></div><div><span class="meta">SEE / 60</span><strong>${result.see}</strong></div><div><span class="meta">TOTAL / 100</span><strong>${result.total.toFixed(1)}</strong></div></div><p class="form-hint">${result.passed ? "Meets the example pass thresholds shown below." : "Does not meet one or both example pass thresholds shown below."}</p>` : `<p class="form-hint">Enter all marks to calculate a result.</p>`}<div class="detail-actions"><button class="button button-primary" type="submit">Save marks</button></div></form>`;
    }).join("");
    const labForms = semesters.map(semester => {
      const record = state.labMarks[String(semester)] || {};
      const result = labAssessmentSummary(record);
      const fields = [
        ["record", "Record / observation", 15], ["internalTest", "Internal test", 15], ["vivaProject", "Viva / mini-project", 10],
        ["writeup", "External write-up", 10], ["execution", "Execution / code", 30], ["analysis", "Result analysis", 10],
        ["externalViva", "External viva", 10]
      ];
      const fieldsMarkup = fields.map(([key, label, maximum]) => `<div class="form-field"><label for="lab${semester}-${key}">${label} / ${maximum}</label><input class="field-control" id="lab${semester}-${key}" name="${key}" type="number" min="0" max="${maximum}" step="0.5" value="${record[key] === undefined ? "" : escapeHtml(record[key])}" required></div>`).join("");
      return `<form class="detail-card marks-form" id="assessment-lab-${semester}"><div class="marks-heading"><div><p class="eyebrow">SEMESTER ${semester} / LAB</p><h2>Laboratory record</h2></div><span class="status status-${result ? "completed" : "available"}"><span class="status-dot" aria-hidden="true"></span>${result ? "Marks saved" : "Marks not entered"}</span></div><div class="form-grid">${fieldsMarkup}</div>${result ? `<div class="score-summary"><div><span class="meta">INTERNAL / 40</span><strong>${result.internal}</strong></div><div><span class="meta">EXTERNAL / 60</span><strong>${result.external}</strong></div><div><span class="meta">TOTAL / 100</span><strong>${result.total}</strong></div></div>` : `<p class="form-hint">Enter all marks to calculate totals. No lab pass threshold is assumed.</p>`}<div class="detail-actions"><button class="button button-primary" type="submit">Save lab marks</button></div></form>`;
    }).join("");
    const content = `<div class="page-heading"><div><p class="eyebrow">ACADEMIC RECORD</p><h1>Assessment</h1><p>Enter first-year marks to track your own results against the pattern in the provided reference.</p></div></div>
      <div class="notice-panel"><strong>Example pattern, not a universal rule.</strong><p>Institutions and regulations differ. Confirm your official scheme, weighting, and pass criteria with your college.</p></div>
      <section class="panel exam-pattern"><div class="panel-header"><h2>Theory examination pattern</h2><span class="meta">REFERENCE SUMMARY</span></div><div class="panel-body"><div class="pattern-grid"><div><span class="meta">FIRST-YEAR SCHEDULE</span><p>Two semesters, two midterms per semester, and one semester-end exam per semester.</p></div><div><span class="meta">CONTINUOUS INTERNAL / 40</span><p>Midterms contribute 30 marks, assignments 5, and viva, presentation, or case study 5.</p></div><div><span class="meta">SEMESTER-END / 60</span><p>Three-hour paper covering all five units. The reference gives ten short answers and five long-answer questions with internal choice.</p></div><div><span class="meta">MIDTERM / 30</span><p>Two-hour paper. Part A: ten compulsory one-mark objective questions. Part B: six five-mark questions, answer any four. Mid-I typically covers Units 1-2; Mid-II covers Units 3-5.</p></div><div><span class="meta">EXAMPLE PASS THRESHOLD</span><p>At least 21/60 in the SEE and 40/100 overall, subject to your institution's rules.</p></div></div><p class="form-hint">This tracker calculates CIE as the average of Mid-I and Mid-II scores, plus the average of two assignment scores, plus viva marks. Check whether your institution uses this exact calculation.</p></div></section>
      <section class="panel lab-pattern"><div class="panel-header"><h2>Laboratory pattern</h2><span class="meta">REFERENCE SUMMARY</span></div><div class="panel-body pattern-grid"><div><span class="meta">INTERNAL / 40</span><p>Record and observation 15, internal test 15, viva or mini-project 10.</p></div><div><span class="meta">EXTERNAL / 60</span><p>Write-up 10, execution or code 30, result analysis 10, viva 10.</p></div></div></section>
      <section class="marks-grid">${semesterForms}</section>
      <section><div class="section-title subsection-heading">Laboratory marks</div><div class="marks-grid">${labForms}</div></section>
      <section class="panel"><div class="panel-header"><h2>Typical first-year subjects</h2></div><div class="panel-body"><p class="profile-copy">The reference describes a common pattern rather than a single national syllabus: Semester 1 includes matrices and calculus, physics or chemistry, C programming, graphics, basic electrical engineering, and laboratories. Semester 2 includes differential equations and vector calculus, applied physics or chemistry, data structures or Python, English, workshop, and laboratories.</p></div></section>`;
    shell(content, "assessment");
    semesters.forEach(semester => {
      document.getElementById(`assessment-semester-${semester}`).addEventListener("submit", guardAsyncAction("theory assessment save", async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const row = {};
        const limits = { mid1: 30, mid2: 30, assignment1: 5, assignment2: 5, viva: 5, see: 60 };
        for (const [key, maximum] of Object.entries(limits)) {
          const raw = data.get(key);
          const value = Number(raw);
          if (raw === null || String(raw).trim() === "" || !Number.isFinite(value) || value < 0 || value > maximum) {
            showToast(`Enter a mark from 0 to ${maximum} for ${key}.`);
            return;
          }
          row[key] = value;
        }
        if (!assessmentSummary(row)) {
          showToast("Check the entered theory marks and try again.");
          return;
        }
        await apiRequest("/api/assessment/validate", {
          method: "POST",
          body: { type: "theory", record: row }
        });
        state.assessmentMarks[String(semester)] = row;
        recordActivity();
        if (!await saveState()) return;
        showToast(`Semester ${semester} marks saved.`);
        render();
      }));
      document.getElementById(`assessment-lab-${semester}`).addEventListener("submit", guardAsyncAction("laboratory assessment save", async event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const limits = { record: 15, internalTest: 15, vivaProject: 10, writeup: 10, execution: 30, analysis: 10, externalViva: 10 };
        const row = {};
        for (const [key, maximum] of Object.entries(limits)) {
          const raw = data.get(key);
          const value = Number(raw);
          if (raw === null || String(raw).trim() === "" || !Number.isFinite(value) || value < 0 || value > maximum) {
            showToast(`Enter a mark from 0 to ${maximum} for ${key}.`);
            return;
          }
          row[key] = value;
        }
        if (!labAssessmentSummary(row)) {
          showToast("Check the entered laboratory marks and try again.");
          return;
        }
        await apiRequest("/api/assessment/validate", {
          method: "POST",
          body: { type: "lab", record: row }
        });
        state.labMarks[String(semester)] = row;
        recordActivity();
        if (!await saveState()) return;
        showToast(`Semester ${semester} lab marks saved.`);
        render();
      }));
    });
  }

  function jobsPage() {
    const renderPaths = query => {
      const filtered = CAREER_PATHS.filter(path => `${path.title} ${path.audience} ${path.description}`.toLowerCase().includes(query));
      document.getElementById("job-path-list").innerHTML = filtered.length ? filtered.map(path => `<article class="tool-card job-card"><div class="tool-card-heading"><div><span class="meta">${escapeHtml(path.audience)}</span><h2>${escapeHtml(path.title)}</h2></div><button class="text-button" type="button" data-action="toggle-saved-job" data-code="${escapeHtml(path.id)}">${state.savedJobs.includes(path.id) ? "Saved" : "Save path"}</button></div><p>${escapeHtml(path.description)}</p><div class="resource-links">${path.links.map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)} <span aria-hidden="true">↗</span></a>`).join("")}</div></article>`).join("") : `<div class="empty-state"><h2>No matching pathways</h2><p>Try a broader search.</p></div>`;
      document.getElementById("job-search-summary").textContent = `${filtered.length} pathways · ${state.savedJobs.length} saved`;
    };
    const resourceMarkup = LEARNING_RESOURCES.map(resource => `<a class="resource-card" href="${escapeHtml(resource.url)}" target="_blank" rel="noopener noreferrer"><span class="meta">${escapeHtml(resource.type)}</span><strong>${escapeHtml(resource.label)} <span aria-hidden="true">↗</span></strong></a>`).join("");
    const content = `<div class="page-heading"><div><p class="eyebrow">CAREER ROUTES</p><h1>Jobs & pathways</h1><p>Explore career routes and external resources. Pathwise does not fetch or claim to list live vacancies.</p></div></div>
      <section class="notice-panel"><strong>Verify current requirements.</strong><p>Recruitment dates, eligibility, and examination rules change. Use the linked organization's official notices before applying.</p></section>
      <section class="panel"><div class="filters single-filter"><input class="field-control" id="job-search" type="search" placeholder="Search role or pathway" aria-label="Search career pathways"></div><div class="catalog-summary" id="job-search-summary"></div><div class="tool-grid compact-tool-grid" id="job-path-list"></div></section>
      <section class="panel"><div class="panel-header"><h2>Learning resources</h2></div><div class="resource-grid">${resourceMarkup}</div></section>`;
    shell(content, "jobs");
    renderPaths(jobSearchQuery);
    document.getElementById("job-search").value = jobSearchQuery;
    document.getElementById("job-search").addEventListener("input", event => {
      jobSearchQuery = event.currentTarget.value.trim().toLowerCase();
      renderPaths(jobSearchQuery);
    });
  }

  function settingsPage() {
    const content = `<div class="page-heading"><div><p class="eyebrow">PREFERENCES</p><h1>Settings</h1><p>Manage your account and synced student data.</p></div></div>
      <section class="settings-list">
        <article class="panel settings-row"><div><h2>Export my data</h2><p>Download your profile, course progress, daily streak and progress-chart history, marks, practice history, and resume details as a JSON file.</p></div><button class="button button-secondary" type="button" data-action="export-data">Export JSON</button></article>
        <article class="panel settings-row"><div><h2>Clear learning data</h2><p>Remove course progress, streak and chart history, assessment marks, saved pathways, and practice history. Your sign-in, diagnostic profile, and resume remain.</p></div><button class="button button-secondary" type="button" data-action="clear-learning-data">Clear learning data</button></article>
        <article class="panel settings-row"><div><h2>Sign out</h2><p>Your encrypted progress remains linked to your account and is available after you sign in again.</p></div><button class="button button-secondary" type="button" data-action="sign-out">Sign out</button></article>
        <article class="panel settings-row"><div><h2>Delete account and data</h2><p>Permanently remove your account, sessions, and encrypted student data from this server.</p></div><button class="button button-secondary" type="button" data-action="delete-account">Delete account</button></article>
      </section>
      <div class="footer-inline"><a href="./privacy.html">Privacy policy</a><a href="./terms.html">Terms &amp; conditions</a></div>`;
    shell(content, "settings");
  }

  function advisorAuditPage() {
    const content = `<div class="page-heading"><div><p class="eyebrow">SERVER-SIDE REVIEW</p><h1>Advisor Audit</h1><p>Checks your saved course progress against the prerequisite graph and profile.</p></div><button class="button button-secondary" type="button" data-action="run-advisor-audit">Run audit</button></div>
      <section class="panel"><div class="panel-header"><h2>Audit report</h2><span class="meta">ACCOUNT-SCOPED</span></div><div class="panel-body" id="advisor-audit-result" aria-live="polite"><p class="profile-copy">Checking your roadmap and enrollment records…</p></div></section>`;
    shell(content, "advisor-audit");
    const runAudit = async () => {
      const target = document.getElementById("advisor-audit-result");
      if (!target) return;
      target.innerHTML = `<p class="profile-copy">Checking your roadmap and enrollment records…</p>`;
      try {
        const report = await apiRequest("/api/advisor-audit", {
          method: "POST",
          body: { profile: state.profile, completed: state.completed, enrolled: state.enrolled }
        });
        const issueMarkup = report.issues.length
          ? report.issues.map(issue => `<article class="audit-issue"><div><span class="meta">${escapeHtml(issue.severity)}</span><h3>${escapeHtml(issue.title)}</h3><p>${escapeHtml(issue.detail)}</p></div><span class="course-code">${issue.courseCodes.map(escapeHtml).join(" · ")}</span></article>`).join("")
          : `<div class="empty-state"><h3>No prerequisite or enrollment conflicts</h3><p>Your recorded course statuses are consistent with this roadmap.</p></div>`;
        const recommendationMarkup = report.recommendations.length
          ? report.recommendations.map(course => `<a class="audit-recommendation" href="#/course/${encodeURIComponent(course.code)}"><span><strong>${escapeHtml(course.name)}</strong><span class="meta">${escapeHtml(course.code)} · SEM ${course.semester} · ${course.credits} CREDITS</span></span><span aria-hidden="true">→</span></a>`).join("")
          : `<p class="profile-copy">No unlocked courses are waiting for enrollment.</p>`;
        const courseRows = report.courses.map(course => `<tr><td><a href="#/course/${encodeURIComponent(course.code)}">${escapeHtml(course.code)}</a></td><td>${escapeHtml(course.name)}</td><td>Semester ${course.semester}</td><td>${course.prerequisites.length ? course.prerequisites.map(escapeHtml).join(", ") : "None"}</td><td>${escapeHtml(course.status)}</td></tr>`).join("");
        target.innerHTML = `<div class="profile-counts audit-summary"><div><span class="meta">COURSES COMPLETE</span><strong>${report.summary.completedCourses} / ${report.summary.recommendedCourses}</strong></div><div><span class="meta">CREDITS</span><strong>${report.summary.completedCredits} / ${report.summary.totalCredits}</strong></div><div><span class="meta">ROADMAP COMPLETE</span><strong>${report.summary.completionPercentage}%</strong></div></div>
          <div class="audit-report-section"><h3>Prerequisite and enrollment checks</h3><div class="audit-issues">${issueMarkup}</div></div>
          <div class="audit-report-section"><h3>Recommended next courses</h3><div class="audit-recommendations">${recommendationMarkup}</div></div>
          <div class="audit-report-section"><h3>Server-verified course plan</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Course</th><th>Planned term</th><th>Prerequisites</th><th>Status</th></tr></thead><tbody>${courseRows}</tbody></table></div></div>
          <p class="form-hint">Audit run ${escapeHtml(new Date(report.generatedAt).toLocaleString())}. Confirm transfer credits and local academic rules with your institution.</p>`;
      } catch (error) {
        Logger.error("advisor_audit.run_failed", error);
        target.innerHTML = `<div class="empty-state" role="alert"><h3>Audit could not be completed</h3><p>${escapeHtml(error.message)}</p></div>`;
      }
    };
    runAudit();
    const runButton = document.querySelector('[data-action="run-advisor-audit"]');
    if (runButton) runButton.addEventListener("click", runAudit);
  }

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function act(action, code) {
    const course = getRoadmap().find(item => item.code === code);
    if (action === "toggle-mobile-menu") {
      mobileMenuOpen = !mobileMenuOpen;
      render();
      return;
    }
    if (action === "sign-out") {
      emailDraft = state.email || "";
      authMode = "login";
      if (!await saveState()) return;
      await apiRequest("/api/auth/logout", { method: "POST" });
      state.email = null;
      accountEncryptionKey = null;
      lastSavedState = defaultState();
      window.location.hash = "";
      render();
      return;
    }
    if (action === "delete-account") {
      if (!window.confirm("Permanently delete your account and all server data? This cannot be undone.")) return;
      const email = state.email;
      await apiRequest("/api/account", { method: "DELETE" });
      removeMigratedLocalData(email);
      state = defaultState();
      lastSavedState = defaultState();
      accountEncryptionKey = null;
      emailDraft = "";
      window.location.hash = "";
      render();
      showToast("Account and data deleted.");
      return;
    }
    if (action === "back-dashboard") return go("dashboard");
    if (action === "edit-profile") return go("edit-profile");
    if (action === "clear-course-filters") {
      catalogFilters = { search: "", semester: "", difficulty: "", status: "" };
      render();
      return;
    }
    if (action === "reset-progress") {
      if (!window.confirm("Clear all completed and enrolled courses on this device? Your profile will remain.")) return;
      state.completed = [];
      state.enrolled = [];
      recordProgressSnapshot();
      if (!await saveState()) {
        render();
        return;
      }
      showToast("Course progress cleared.");
      go("dashboard");
      return;
    }
    if (action === "toggle-roadmap-task") {
      if (!state.roadmapTasks.includes(code)) recordActivity();
      state.roadmapTasks = state.roadmapTasks.includes(code)
        ? state.roadmapTasks.filter(task => task !== code)
        : [...state.roadmapTasks, code];
      if (!await saveState()) {
        render();
        return;
      }
      render();
      return;
    }
    if (action === "toggle-practiced") {
      if (!state.practicedQuestions.includes(code)) recordActivity();
      state.practicedQuestions = state.practicedQuestions.includes(code)
        ? state.practicedQuestions.filter(item => item !== code)
        : [...state.practicedQuestions, code];
      if (!await saveState()) {
        render();
        return;
      }
      render();
      return;
    }
    if (action === "toggle-saved-job") {
      state.savedJobs = state.savedJobs.includes(code)
        ? state.savedJobs.filter(item => item !== code)
        : [...state.savedJobs, code];
      if (!await saveState()) {
        render();
        return;
      }
      render();
      return;
    }
    if (action === "start-mock-test") {
      const quiz = MOCK_TESTS.find(test => test.id === code);
      if (!quiz) {
        showToast("That mock test is not available.");
        return;
      }
      state.activeTest = { quizId: quiz.id, index: 0, answers: [], checked: false };
      if (!await saveState()) return;
      render();
      return;
    }
    if (action === "next-mock-question") {
      const active = state.activeTest;
      const quiz = active && MOCK_TESTS.find(test => test.id === active.quizId);
      if (!active || !quiz || !active.checked) {
        showToast("Select and check an answer before continuing.");
        return;
      }
      if (active.index + 1 < quiz.questions.length) {
        active.index += 1;
        active.checked = false;
        delete active.selectedAnswer;
        if (!await saveState()) {
          render();
          return;
        }
        render();
        return;
      }
      const { score, total } = Core.scoreQuiz(quiz.questions, active.answers);
      state.mockTestResults.push({ quizId: quiz.id, score, total, completedAt: new Date().toISOString() });
      recordActivity();
      state.activeTest = null;
      if (!await saveState()) {
        render();
        return;
      }
      showToast(`Test complete: ${score} / ${total}.`);
      render();
      return;
    }
    if (action === "exit-mock-test") {
      if (state.activeTest && !window.confirm("Exit this test? Your unfinished answers will be discarded.")) return;
      state.activeTest = null;
      if (!await saveState()) {
        render();
        return;
      }
      go("mock-test");
      return;
    }
    if (action === "exit-mock-interview") {
      const active = state.mockInterview;
      if (active) {
        const draft = document.getElementById("interview-answer");
        if (draft) {
          if (!Array.isArray(active.answers)) active.answers = [];
          active.answers[active.index] = draft.value;
          if (draft.value.trim()) recordActivity();
        }
        const prompts = interviewPromptsForRole(active.role).slice(0, active.questionCount);
        state.interviewSessions.push({
          role: active.role, format: active.format, completed: false, completedAt: new Date().toISOString(),
          answers: prompts.slice(0, active.index + 1).map((item, index) => ({ prompt: item.prompt, response: (active.answers || [])[index] || "" }))
        });
        state.mockInterview = null;
        if (!await saveState()) {
          render();
          return;
        }
        showToast("Practice notes saved.");
      }
      go("mock-interview");
      return;
    }
    if (action === "download-resume") {
      const resume = state.resume;
      const content = [
        resume.fullName || "Your name", resume.headline || state.profile.goal,
        [resume.location, state.email].filter(Boolean).join(" | "), "",
        "SUMMARY", resume.summary, "", "EDUCATION", resume.education, "",
        "SKILLS", resume.skills, "", "EXPERIENCE", resume.experience, "",
        "PROJECTS / PROOF OF WORK", resume.projects, "", "LINKS", resume.links
      ].join("\r\n");
      downloadFile("pathwise-resume.txt", content, "text/plain;charset=utf-8");
      showToast("Resume download requested. Check your browser downloads.");
      return;
    }
    if (action === "export-data") {
      const exportData = {
        format: "Pathwise local student data",
        exportedAt: new Date().toISOString(),
        student: {
          email: state.email, profile: state.profile, completed: state.completed, enrolled: state.enrolled,
          assessmentMarks: state.assessmentMarks, labMarks: state.labMarks, mockTestResults: state.mockTestResults,
          activeTest: state.activeTest, mockInterview: state.mockInterview,
          practicedQuestions: state.practicedQuestions, interviewSessions: state.interviewSessions,
          resume: state.resume, savedJobs: state.savedJobs, roadmapTasks: state.roadmapTasks,
          activityDays: state.activityDays, progressHistory: state.progressHistory
        }
      };
      downloadFile("pathwise-student-data.json", JSON.stringify(exportData, null, 2), "application/json");
      showToast("Data export requested. Check your browser downloads.");
      return;
    }
    if (action === "clear-learning-data") {
      if (!window.confirm("Clear course progress, streak and chart history, assessments, and practice history? Your profile and resume will remain.")) return;
      state.completed = [];
      state.enrolled = [];
      state.assessmentMarks = {};
      state.labMarks = {};
      state.mockTestResults = [];
      state.activeTest = null;
      state.practicedQuestions = [];
      state.interviewSessions = [];
      state.mockInterview = null;
      state.savedJobs = [];
      state.roadmapTasks = [];
      state.activityDays = [];
      state.progressHistory = [];
      if (!await saveState()) {
        render();
        return;
      }
      showToast("Learning data cleared.");
      render();
      return;
    }
    if (action === "copy-profile") {
      const lines = [
        state.resume.fullName || "Student",
        state.resume.headline || state.profile.goal,
        `${state.profile.branch} · Semester ${state.profile.semester}`,
        state.resume.summary,
        state.resume.projects
      ].filter(Boolean);
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        showToast("Clipboard access is unavailable in this browser.");
        return;
      }
      navigator.clipboard.writeText(lines.join("\n")).then(
        () => showToast("Profile summary copied."),
        error => {
          Logger.error("profile.summary_copy_failed", error);
          showToast("Profile summary could not be copied.");
        }
      );
      return;
    }
    if (action === "details") return go(`course/${encodeURIComponent(code)}`);
    if (!course) return;
    if (action === "enroll") {
      if (!prerequisitesMet(course)) {
        showToast("Prerequisites not met. Enrollment is locked.");
        return;
      }
      await apiRequest("/api/course-action", {
        method: "POST",
        body: { action, courseCode: code, profile: state.profile, completed: state.completed, enrolled: state.enrolled }
      });
      if (!state.enrolled.includes(code) && !state.completed.includes(code)) state.enrolled.push(code);
      recordActivity();
      if (!await saveState()) {
        render();
        return;
      }
      Logger.info("course.enrolled");
      showToast(`Enrolled in ${course.code}.`);
    } else if (action === "complete") {
      if (!state.enrolled.includes(code) || !prerequisitesMet(course)) {
        showToast("Enroll in this course after meeting its prerequisites.");
        return;
      }
      await apiRequest("/api/course-action", {
        method: "POST",
        body: { action, courseCode: code, profile: state.profile, completed: state.completed, enrolled: state.enrolled }
      });
      state.enrolled = state.enrolled.filter(item => item !== code);
      state.completed.push(code);
      recordActivity();
      recordProgressSnapshot();
      if (!await saveState()) {
        render();
        return;
      }
      Logger.info("course.completed");
      showToast(`${course.code} marked complete. New courses may now be available.`);
    }
    render();
  }

  function render() {
    if (!state.email) {
      renderLanding();
      return;
    }
    if (!state.profile) {
      renderOnboarding();
      return;
    }
    const route = getRoute();
    if (route.page === "catalog") catalog();
    else if (route.page === "course") courseDetail(decodeURIComponent(route.code || ""));
    else if (route.page === "profile") profilePage();
    else if (route.page === "edit-profile") editProfilePage();
    else if (route.page === "mock-test") mockTestPage();
    else if (route.page === "interview-prep") interviewPrepPage();
    else if (route.page === "resume") resumePage();
    else if (route.page === "mock-interview") mockInterviewPage();
    else if (route.page === "assessment") assessmentPage();
    else if (route.page === "advisor-audit") advisorAuditPage();
    else if (route.page === "jobs") jobsPage();
    else if (route.page === "settings") settingsPage();
    else dashboard();
  }

  async function initialize() {
    try {
      await apiRequest("/api/health");
      const [catalogResponse, testsResponse] = await Promise.all([
        fetch("./data/course-catalog.json", { cache: "no-cache" }),
        fetch("./data/mock-tests.json", { cache: "no-cache" })
      ]);
      if (!catalogResponse.ok || !testsResponse.ok) {
        throw new Error("Course or mock-test data could not be loaded.");
      }
      const catalog = await catalogResponse.json();
      const tests = await testsResponse.json();
      if (!catalog || !Array.isArray(catalog.branches) || !Array.isArray(catalog.careers) ||
          !Array.isArray(catalog.courses) || !catalog.branchCodes || !catalog.careerCodes ||
          !Array.isArray(catalog.sharedCodes) || !Array.isArray(tests)) {
        throw new Error("Course or mock-test data has an invalid format.");
      }
      BRANCHES = catalog.branches;
      CAREERS = catalog.careers;
      COURSES = catalog.courses;
      CAREER_CODES = catalog.careerCodes;
      BRANCH_CODES = catalog.branchCodes;
      SHARED_CODES = catalog.sharedCodes;
      MOCK_TESTS = tests;
      studentDataRepository = StudentData.createRepository({
        storage: Persistence,
        store: localStorage,
        authKey: AUTH_STORAGE_KEY,
        legacyKey: STORAGE_KEY,
        getCourses: () => COURSES,
        getMockTests: () => MOCK_TESTS,
        isValidProfile
      });

      Core.topologicalOrder(COURSES);
      for (const branch of BRANCHES) {
        for (const goal of CAREERS) {
          const recommended = Core.getCoursesForProfile(
            { branch, goal }, COURSES, BRANCH_CODES, CAREER_CODES, SHARED_CODES
          );
          Core.buildRoadmap({ semester: 1 }, recommended);
        }
      }
      for (const mockTest of MOCK_TESTS) {
        if (!mockTest || typeof mockTest.id !== "string" || typeof mockTest.title !== "string") {
          throw new Error("Mock-test data has an invalid entry.");
        }
        Core.scoreQuiz(mockTest.questions, []);
      }
      try {
        authAccounts = studentDataRepository.readAccounts();
      } catch (error) {
        authAccounts = {};
        Logger.error("student_data.local_accounts_load_failed", error);
        showToast("Saved accounts on this browser could not be read. You can still sign in.");
      }
      try {
        legacyStudent = studentDataRepository.readLegacyStudent();
      } catch (error) {
        legacyStudent = null;
        Logger.error("student_data.legacy_progress_load_failed", error);
        showToast("Older browser-stored progress could not be read.");
      }
      render();
    } catch (error) {
      Logger.error("app.initialization_failed", error);
      app.innerHTML = `<main class="signin-only-page"><section class="landing-signin" role="alert"><h1>Pathwise could not load</h1><p>The server or application data is unavailable. Start Pathwise with <code>npm start</code> and refresh this page.</p></section></main>`;
      showToast(error.message || "Application data is unavailable.");
    }
  }

  app.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    if (target.dataset.action === "toggle-password") {
      const input = document.getElementById(target.dataset.target);
      if (!input) return;
      const isVisible = input.type === "password";
      input.type = isVisible ? "text" : "password";
      target.textContent = isVisible ? "Hide" : "Show";
      target.setAttribute("aria-pressed", String(isVisible));
      return;
    }
    act(target.dataset.action, target.dataset.code).catch(error => {
      Logger.error("ui.action_failed", error);
      showToast(error.message || "This action could not be completed.");
    });
  });
  window.addEventListener("hashchange", () => {
    mobileMenuOpen = false;
    render();
  });

  initialize();
})();
