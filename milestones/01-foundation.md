# Milestone 01: Foundation — Project Setup, Auth, Data Model

**Objective:** Stand up the full-stack project with a secure email/password auth system, the complete data model, and seed data so later milestones can build on a working base.

**Technical Context:**
-   Stack: Next.js (App Router, TypeScript) with API routes, PostgreSQL, Prisma ORM.
-   Auth: email/password with bcrypt hashing, httpOnly session cookie, CSRF protection on all mutating routes.
-   Data model: see `docs/data-model.md`.

**Requirements:**
1.  Initialize the Next.js project with TypeScript, App Router, and a development database (PostgreSQL via Docker or local install).
2.  Create the Prisma schema for all entities: User, Recipe, Ingredient, Step, Tag, RecipeTag, ImportAttempt.
3.  Implement user registration and login:
    -   `POST /api/auth/register` — validate email/password, hash password, create user, set session cookie.
    -   `POST /api/auth/login` — verify password, set session cookie.
    -   `POST /api/auth/logout` — clear session cookie.
4.  Protect all recipe-mutating routes with a session check middleware; expose user identity to the client.
5.  Create seed data: 3 sample recipes matching the reference table structure (including hierarchical steps and a final bake step) so the view milestone can be tested without URL scraping.
6.  Add basic project hygiene: `.env` handling (database URL, session secret), lint config, CI script that runs lint + typecheck + tests.

**Instructions for LLM:**
-   Follow the entity definitions in `docs/data-model.md` exactly, including `sortOrder` fields and `parentStepId` for step hierarchy.
-   Do not implement scraping, search, or sharing in this milestone — only auth, data model, and seed data.
-   Keep API routes under `/api/auth` and `/api/recipes` with clear input validation (zod or similar).
-   The seed recipes must be able to produce the exact table layout shown in the reference: title header, prep note, merged action columns ("melt", "mix", "fold in"), and a final "bake" column.
-   Verify with: run the seed script, log in as a seeded user, and confirm the 3 sample recipes are stored with their step hierarchy intact.
