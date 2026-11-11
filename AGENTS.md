# Agent Guardrails

All coding agents working in this repository must follow every rule below.

You are the coding agent for this project.

You may write and edit code only within the approved project folder. You must follow every rule below.

## PROJECT ROOT
PROJECT ROOT is /home/pratham/crm.
- Your entire scope is restricted to the project folder provided by the user.
- Never read, write, create, modify, move, rename, or delete anything outside PROJECT ROOT.
- Never access parent directories, home directories, unrelated workspaces, credentials, SSH keys, cloud configuration, browser data, or any unrelated files.
- Never use broad filesystem searches outside PROJECT ROOT.
- Never use paths outside PROJECT ROOT in commands, scripts, configurations, or generated files.

## GIT RESTRICTION
- Do not use Git in any form.
- Do not run git status, git diff, git log, git add, git commit, git checkout, git reset, git clean, git restore, git branch, git merge, git pull, git push, or any other Git command.
- Do not read, inspect, or modify the .git directory.
- Do not create commits, branches, tags, remotes, pull requests, GitHub issues, or GitHub releases.
- Report changed files using normal project-relative file paths only.

## ALLOWED WORK
- You may create and edit code, tests, documentation, and configuration files inside PROJECT ROOT when required by the approved task.
- Keep all changes minimal, precise, maintainable, and directly related to the task.
- Preserve existing user work.
- Inspect relevant files before editing them.
- Do not overwrite existing content unless the requested task requires it.
- Do not perform unrelated cleanup, refactoring, formatting, dependency updates, or architecture changes.

## DELETIONS AND DESTRUCTIVE ACTIONS: ALWAYS ASK FIRST
You must stop and ask for explicit user approval before doing any of the following:

- Delete any file or folder.
- Rename or move any file or folder.
- Overwrite a file in a way that removes existing content.
- Run rm, truncate, find-delete, or any destructive shell command.
- Run reset, cleanup, restore, or similar repository/file restoration commands.
- Remove dependencies.
- Replace lockfiles.
- Run destructive database migrations.
- Drop, reset, delete, truncate, or bulk-modify database data.
- Bulk rewrite code or automatically change many files.
- Deploy, publish, send emails/messages/notifications, create external accounts, or make purchases.
- Access, reveal, log, upload, or transmit secrets, API keys, passwords, tokens, or private data.
- Modify production settings, cloud infrastructure, domains, DNS, or external services.

For every approval request, clearly provide:

1. Exact action proposed
2. Exact affected files, folders, data, or service
3. Why the action is necessary
4. Whether it is reversible
5. A safer alternative, if available

## DEPENDENCIES AND EXTERNAL SERVICES
- Do not install packages without explicit approval.
- Do not remove packages without explicit approval.
- Do not add a database, cloud provider, authentication provider, payment provider, analytics tool, email provider, AI provider, or third-party integration without explicit approval.
- Before proposing a dependency, explain why it is needed, alternatives, security impact, and affected files.
- Never create real external accounts or use real credentials.

## SECURITY AND GOVERNANCE
- Enforce least privilege.
- Never bypass authentication, authorization, approval workflows, validation, or audit logging.
- Every sensitive mutation must check the user’s permissions.
- Every sensitive mutation must create an append-only audit event.
- Never hardcode secrets.
- Use environment variables and create/update .env.example only with placeholder values.
- Never log passwords, API keys, tokens, private client data, or sensitive user data.
- Do not allow standard users to modify audit events.
- Do not implement any action that gives a user more access than their assigned role permits.

## APPLICATION ROLE MODEL
- The CEO/CTO is the only Super Admin.
- All founders, employees, interns, contractors, and other members report directly to the CEO/CTO unless the user explicitly changes this.
- CFO has finance-only permissions.
- CGO has growth/sales-only permissions.
- CMO has marketing-only permissions.
- VP Engineering & Quality has task, engineering, QA, testing, incident, and release-related permissions.
- Employees only access their assigned projects, tasks, meetings, documents, and permitted data.
- CEO approval is required for role changes, sensitive deployment actions, user deactivation, client deletion, high-risk changes, and other actions defined by the user.

## ATTENDANCE AND PRIVACY
- Log successful login time and explicit logout/session-end time only.
- Daily attendance means: user logged in today or did not log in today.
- Do not track total app time, idle time, mouse/keyboard activity, screenshots, browsing activity, or surveillance-style productivity data.
- Measure work using assigned tasks, updates, proof of work, reviews, and approvals.

## ENGINEERING QUALITY
- Use TypeScript strict mode.
- Keep code simple, readable, modular, and concise.
- Do not write unnecessarily long code or speculative abstractions.
- Do not use any unless clearly justified.
- Validate all external input.
- Keep HTTP routes thin.
- Put business rules in services.
- Keep database queries in repositories/data-access layers.
- Keep permission checks in policy/authorization layers.
- Use database migrations for schema changes.
- Add tests for business rules, permissions, approvals, and sensitive workflows.
- Do not create empty folders, placeholder services, or unused abstractions.
- Do not introduce microservices unless explicitly instructed.
- Do not add AI features unless explicitly instructed.
- Do not claim a feature works unless it was actually tested.

## AUDIT LOGGING
- Audit events must be append-only.
- Record actor, action, timestamp, entity type, entity ID, relevant project/client context, and safe before/after data where appropriate.
- Redact secrets and sensitive values from audit events.
- Do not allow audit event editing or deletion through the application.
- Log sensitive actions such as role changes, permission changes, user deactivation, approvals, deployments, client changes, and workflow changes.

## WORKFLOW
1. Restate the requested task in one short paragraph.
2. Identify relevant files inside PROJECT ROOT.
3. Inspect only the relevant files.
4. For substantial work, provide a concise implementation plan before editing.
5. Ask for approval before any destructive, external, dependency, database, or architecture-changing action.
6. Implement only the approved scope.
7. Run focused, non-destructive checks/tests when possible.
8. Report:
   - What changed
   - Changed file paths
   - Tests/checks run
   - Any remaining risks, limitations, or user decisions needed
9. Never make unrelated changes.

## DEFAULT BEHAVIOR
- When uncertain, ask before acting.
- Prefer the smallest safe change.
- Stay within PROJECT ROOT.
- Do not use Git.
- Do not delete, move, rename, overwrite destructively, deploy, install dependencies, or contact external services without explicit user approval.
