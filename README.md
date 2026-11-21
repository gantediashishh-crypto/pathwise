# Pathwise

Pathwise is an engineering course planner with a browser interface and a Node.js/Express API. Course and mock-test content is versioned as JSON; accounts, sessions, encrypted student records, and advisor audits are scoped to authenticated users.

## Run locally

Requires Node.js 22.13 or later.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:3000`. Do not open `index.html` directly: the app requires its same-origin API.

The SQLite database is created at `.pathwise-data/pathwise.sqlite`. Set `PATHWISE_DB_PATH` to choose another location.

## Verify

```powershell
npm test
npm run check
```

`app.js` coordinates routes and page interactions. Course logic, encryption, storage, validated student-data access, activity tracking, progress and streak views, API transport, shared HTML escaping, and structured logging are isolated in testable modules. The test suite covers course-graph integrity for every branch/career combination, student-data normalization, streak and progress tracking, scoring and mark validation, encrypted storage, API request handling, safe HTML escaping, structured logs, served application assets, API authentication, session isolation, server-side enrollment checks, and advisor-audit validation.

## API

- `POST /api/auth/register` and `POST /api/auth/login` create accounts and issue HttpOnly session cookies.
- `POST /api/auth/logout` and `DELETE /api/account` end a session or remove the account.
- `GET /api/state` and `PUT /api/state` sync AES-GCM ciphertext per account.
- `POST /api/advisor-audit` validates a profile and returns a prerequisite-aware audit.
- `POST /api/course-action` checks enrollment and completion rules on the server.
- `POST /api/assessment/validate` validates theory and laboratory marks.

## Deployment notes

Deploy behind HTTPS, protect the SQLite database and backups, and configure `PORT`, `HOST`, `PATHWISE_DB_PATH`, and `NODE_ENV=production`. If TLS terminates at a trusted reverse proxy, set `PATHWISE_TRUST_PROXY=1`. Production cookies are marked `Secure` when `NODE_ENV=production`.

Email verification, password recovery, and Google OAuth are not configured. Do not treat this project as a production identity provider until those flows, operational monitoring, backup/restore, and a deployment-specific security review are complete.

## Deploy so it opens in any browser

Localhost links only work on your own computer. To share Pathwise, host it on any Node 22.13+ or Docker host.

1. Docker: `docker build -t pathwise .` then `docker run -p 3000:3000 -v pathwise-data:/data pathwise`. The image sets `NODE_ENV=production` and stores the database in `/data`.
2. Render: push this folder to GitHub and create a Blueprint from `render.yaml`. It mounts a 1 GB disk at `/data` so accounts and progress survive restarts. (A paid plan is needed for a persistent disk.)
3. Custom domain: add the domain in your host's dashboard, then create the DNS record it shows (CNAME for a subdomain, A or ALIAS for the root domain). HTTPS certificates are issued automatically.
4. Only files on an allowlist are public: the pages, `app.js`, the `pathwise-*.js` modules, `styles.css`, the logo, favicon, and the two JSON data files. Server code, tests, manifests and the database are never served.

Browsers: the app uses standard Web Crypto, fetch and CSS. It needs HTTPS (or localhost) because password hashing and encryption use `crypto.subtle`. Current Chrome, Edge, Firefox and Safari are supported.
