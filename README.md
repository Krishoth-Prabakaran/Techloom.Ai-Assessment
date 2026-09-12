# Techloom Practical Assessment

Two independently deployable projects matching the assessment brief.

- Task 01 POS: React + Vite frontend and Node.js + Express + PostgreSQL-ready backend
- Task 02 Storefront: Next.js frontend and Node.js + Express + PostgreSQL-ready backend

## Live links

- Repository: `https://github.com/YOUR_USERNAME/techloom-assessment`
- Task 01: `TBD`
- Task 02: `TBD`

## Local setup

Run each backend and frontend in separate terminals. These commands are for Windows PowerShell.

### Task 01: POS

Terminal 1:

```powershell
cd D:\Assessment\task-01\backend
npm install
npm run dev
```

Terminal 2:

```powershell
cd D:\Assessment\task-01\frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:4001`.

Run the concurrency tests with:

```powershell
cd D:\Assessment\task-01\backend
npm test
```

### Task 02: Storefront

Terminal 1:

```powershell
cd D:\Assessment\task-02\backend
npm install
npm run dev
```

Terminal 2:

```powershell
cd D:\Assessment\task-02\frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The API runs on `http://localhost:4002`.

Set `DATABASE_URL` from the relevant `.env.example` file. Use the exact Supabase **Session pooler / Node.js** connection string on port `5432`; do not guess the database hostname. Without it, the backends cannot load the Supabase rows.

See each project README for feature walkthroughs, API routes, environment variables, and deployment notes.

## Database change workflow

Database changes are tracked as SQL migrations and documentation updates together.

1. Append the next numbered section to `backend/database/migrations/001_initial_schema.sql`, for example `-- 003: Add customers`.
2. Put the complete SQL change under that section.
3. Add a matching heading to that backend's `database/README.md` describing the change and its rollback or data-safety considerations.
4. Update the backend code in the same change when the schema contract changes.
5. Test the migration against the shared Supabase project before deploying.

Both backends execute the consolidated `001_initial_schema.sql` file on startup and query their own table names from the shared Supabase project.
