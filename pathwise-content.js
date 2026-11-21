(function attachPathwiseContent(root, factory) {
  const content = factory();
  if (typeof module === "object" && module.exports) module.exports = content;
  else root.PathwiseContent = content;
})(globalThis, function createPathwiseContent() {
  "use strict";

  const YEAR_ROADMAP = [
    { year: 1, title: "Build foundations", tasks: ["Learn one programming language and engineering mathematics basics.", "Join one technical club or engineering society.", "Create a GitHub account and document one small project."] },
    { year: 2, title: "Develop core skills", tasks: ["Study branch fundamentals and data structures.", "Build and document a project related to your branch.", "Practice technical problem solving each week."] },
    { year: 3, title: "Choose a direction", tasks: ["Select a specialization and complete a focused project.", "Apply for internships or supervised industry experience.", "Choose a preparation track: placements, GATE, higher studies, or public service."] },
    { year: 4, title: "Prepare for transition", tasks: ["Complete a capstone and maintain a clear project portfolio.", "Prepare a role-specific resume and practice interviews.", "Track applications, exams, or postgraduate deadlines."] }
  ];
  const INTERVIEW_TOPICS = [
    { id: "programming", title: "Programming fundamentals", questions: [
      ["How would you explain the difference between a variable and a constant?", "A variable can be reassigned; a constant represents a value intended not to change. Language rules differ."],
      ["What is the purpose of a function?", "A function names a reusable unit of behavior, often with inputs and an output."],
      ["How do you approach debugging a program?", "Reproduce the issue, isolate the smallest failing case, inspect assumptions and state, fix the cause, then retest."],
      ["What is the difference between a compile-time and run-time error?", "A compile-time error is detected during translation or static checks; a run-time error occurs while executing."]
    ] },
    { id: "dsa", title: "Data structures and algorithms", questions: [
      ["When would you use a queue instead of a stack?", "A queue is useful when items should be processed in arrival order; a stack is useful for last-in, first-out behavior."],
      ["What does Big O notation describe?", "It describes how an algorithm's resource use grows with input size, commonly time or memory."],
      ["How does binary search reduce work?", "On sorted data, each comparison discards roughly half the remaining search interval."],
      ["What trade-off can a hash table introduce?", "It offers fast average-case lookup but uses extra memory and must handle collisions."]
    ] },
    { id: "systems", title: "Systems and networks", questions: [
      ["What is the role of an operating system?", "It manages hardware resources and provides abstractions and services for applications."],
      ["What is the difference between a process and a thread?", "A process has its own execution context and resources; threads are execution paths within a process that share resources."],
      ["Why is DNS used?", "DNS maps human-readable domain names to network records such as IP addresses."],
      ["What is the purpose of version control?", "It records changes, supports collaboration, and allows teams to inspect or restore earlier states."]
    ] },
    { id: "projects", title: "Project discussion", questions: [
      ["Describe a technical problem you solved and how you validated the result.", "State the problem, constraints, your contribution, the implementation, and evidence from tests or measurements."],
      ["What would you change if you rebuilt your project?", "Identify a specific limitation, explain its impact, and propose a practical improvement."],
      ["How did you divide work on a team project?", "Explain ownership, interfaces, coordination, and how integration issues were handled."],
      ["How do you decide what to build first?", "Prioritize by user value, risk, dependencies, and the smallest testable outcome."]
    ] }
  ];
  const CAREER_PATHS = [
    { id: "placements", title: "Private-sector placements", audience: "Campus and off-campus roles", description: "Build role-relevant fundamentals, projects, a concise resume, and interview practice. Openings and eligibility are controlled by each employer.", links: [{ label: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs/" }, { label: "Naukri", url: "https://www.naukri.com/" }] },
    { id: "psu", title: "PSU and government engineering", audience: "GATE and direct recruitment routes", description: "Check each organization's current eligibility, examination route, and application dates. Requirements differ by employer and discipline.", links: [{ label: "GATE information", url: "https://gate2025.iitr.ac.in/" }, { label: "ISRO Careers", url: "https://www.isro.gov.in/Careers.html" }, { label: "BARC Careers", url: "https://www.barc.gov.in/careers/" }] },
    { id: "higher-studies", title: "Higher studies and research", audience: "M.Tech, MS, and research", description: "Compare entrance requirements, research areas, funding, and application deadlines before selecting programs.", links: [{ label: "NPTEL", url: "https://nptel.ac.in/" }, { label: "MIT OpenCourseWare", url: "https://ocw.mit.edu/" }] },
    { id: "public-service", title: "Public service and management", audience: "Civil services and management routes", description: "Plan around the published examination syllabus, eligibility rules, and official notices for each route.", links: [{ label: "UPSC", url: "https://www.upsc.gov.in/" }, { label: "National Apprenticeship Training Scheme", url: "https://nats.education.gov.in/" }] }
  ];
  const LEARNING_RESOURCES = [
    { label: "Virtual Labs", type: "Engineering laboratory practice", url: "https://www.vlab.co.in/" },
    { label: "CS50", type: "Computer science foundations", url: "https://cs50.harvard.edu/x/" },
    { label: "NPTEL", type: "Engineering courses", url: "https://nptel.ac.in/" },
    { label: "LeetCode", type: "Programming practice", url: "https://leetcode.com/" }
  ];

  return Object.freeze({ YEAR_ROADMAP, INTERVIEW_TOPICS, CAREER_PATHS, LEARNING_RESOURCES });
});
