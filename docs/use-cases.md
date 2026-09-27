# Use cases and example briefs

The reusable foundation is a prompt-to-project workflow with saved source, sandbox execution, measured build results, a preview and explicit publishing. It can support useful personal software, team tools, customer applications and specialized builders. Pick the smallest architecture that fits the data and users.

## Apps that fit the current frontend path

| App | Example brief |
|---|---|
| Personal planner | “Build a keyboard-accessible weekly planner. Save locally in the browser. Include export/import and clear empty states. No wallet or contract.” |
| Dataset explorer | “Build a CSV explorer with column filters, a chart and downloadable filtered rows. Process the uploaded file in the browser. Show malformed rows rather than silently dropping them.” |
| Public resource directory | “Build an accessible directory from this synthetic JSON dataset, with tags, search and individual entries. Explain when data was last updated.” |
| API dashboard | “Build a read-only dashboard for this public API schema. Include loading, empty, stale and error states. Never embed a private API key.” |

These briefs use browser storage, supplied files or an already available API. Browser-local storage is not a shared database or a backup. An interface using mock data must remain labeled as a prototype until connected to a real service.

## SaaS and user applications

A support portal, booking application, project workspace or shared knowledge base can use the generated frontend. The application also needs its own backend with accounts, tenant boundaries, roles, database, audit records and notifications. Fletch's platform account system does not automatically become authentication for every generated app.

Develop the frontend against an explicit API contract first. Implement ownership/tenant checks in the backend, including background jobs and file access. Add an isolated runtime/publishing adapter if the builder is expected to launch those services itself. Keep per-application secrets separate from platform credentials. See [web and server applications](extensions/web.md).

Example brief: “Build a customer support workspace for an existing authenticated API. Include ticket list, detail, reply, attachments and status history. Use the supplied endpoint schema; show permission errors. Do not invent a server or pretend mock replies were sent.”

## Data collection and delivery

A useful data application turns approved sources into consistent records people can search, compare or export. Examples include product availability monitoring, public procurement notices, research datasets, documentation changes and community event directories.

Specify inputs, fields, refresh cadence, validation rules and output destination. Keep original source URL and capture time with each record. Run collection in a separately provisioned worker, then present results through the generated app. Scheduling, browser automation and data delivery are extension work, not features of the current static publisher.

Example brief: “Create a dashboard for a scheduled public-catalog collector. Show source, last successful run, changed records, validation errors and CSV/JSON export. Use this backend API schema. Include pause/resume controls with explicit confirmation; never treat an HTTP 200 as proof of valid extracted data.” See [data workflows](extensions/data-workflows.md).

## Developer and community projects

Reuse the sandbox and queue for a framework-specific coding workspace. Adapt templates for accessible dashboards, educational tools or local-first applications. Add scoped MCP tools for an existing data API. Build an open-data portal with transparent provenance rather than hidden confidence claims. Extend the contract backend for another chain while keeping signing and reconciliation outside the model process.

Choose a concrete workflow, publish a reproducible example using synthetic/public data, and document the missing adapters. A useful fork can be small: one reliable template, one data connector or one well-tested runtime benefits the rest of the community.
