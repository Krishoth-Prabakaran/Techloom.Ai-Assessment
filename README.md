# Techloom Practical Assessment

Two independently deployable, full-stack projects matching the assessment brief.

- **Task 01 — POS system**: React + Vite frontend, Node.js + Express + PostgreSQL backend
- **Task 02 — Storefront**: Next.js frontend, Node.js + Express + PostgreSQL backend

**Demo admin login (both apps):** username `admin`, password `admin`

## Live links

- Repository: `https://github.com/Krishoth-Prabakaran/Techloom.Ai-Assessment`
- Task 01: **Deployment URL required before submission**
- Task 02: **Deployment URL required before submission**

## Highlights

**Accounts and access control**
- Real registration and login on both apps, with passwords hashed server-side (`scrypt`, salted) — never stored in plaintext.
- Two roles: self-registered accounts are customers by default; a seeded staff account (`admin` / `admin`) has full management access. There is no way to self-assign the staff role.
- Role-aware UI: staff manage the product catalog and fulfill orders; customers shop and check out. Each side only sees the actions relevant to it.

**Inventory and checkout**
- Stock reservations are concurrency-safe under load — verified with an automated test suite that exercises simultaneous reservation attempts against limited stock.
- Full order lifecycle: `reserved` → `paid` (or `failed` / `expired`, including a simulated payment timeout) → `ready` → `picked-up`, with staff marking orders ready and customers redeeming them by order ID.
- Full catalog CRUD (create, edit, delete products) for staff, with image support.

**Personal data, per account**
- Shopping carts persist server-side per account, so they survive logging out and back in (even from a different device) and never leak between accounts sharing a browser.
- Order history is private: a customer only ever sees their own orders; staff retain full visibility to manage fulfillment.

**Engineering practices**
- Schema changes tracked as incremental, numbered SQL migrations with matching documentation for every change (see `backend/database/README.md` in each task).
- Both backends run against a shared Supabase Postgres project with table-name isolation between the two apps.
- Responsive UI with light/dark themes across both apps.

## Accounts and login

Both frontends are gated behind real sign-in, backed by a `users` table in each backend's database (`users` for Task 01, `store_users` for Task 02 — kept separate even though both share one Supabase project). Passwords are hashed with Node's `crypto.scrypt`; plaintext passwords are never stored. Each app tracks its own session (via `localStorage`), so register/sign in separately on Task 01 and Task 02.

Anyone can register from the login screen ("Create an account") — self-registration always creates a `user` role. There is no public way to create an `admin` account; a demo admin is seeded automatically by the migration so staff features stay reachable:

| Username | Password | Access |
| --- | --- | --- |
| `admin` | `admin` | Seeded staff account. Browse products, edit/manage the catalog, view all orders, and mark paid orders "ready". Cannot shop or place orders — cart/checkout is hidden. |
| *(register your own)* | — | New accounts get the customer view: shop and check out. Once staff mark an order "ready", enter its order ID on the Orders page to pick it up. Catalog management is hidden. |

### Personal carts and private order history

Every account's cart and order history are tied to that account in the database, not the browser:

- **Cart** — stored server-side (`users.cart` / `store_users.cart`), keyed by account. Add items, log out, log back in (even on another device) and the cart is exactly as you left it. Switching accounts on the same browser never leaks one person's cart into another's.
- **Orders** — each order is stamped with the account that placed it (`orders.user_id` / `store_orders.user_id`). `GET /api/orders` only returns the requester's own orders — unless their role is `admin`, in which case they see every order (needed to fulfill and mark orders ready). So if a customer has 2 orders, only that customer (and staff) can see them; other customers never can.

### Order pickup flow

Both apps now support a pickup workflow instead of ending at payment:

1. A customer (`user`) checks out — the order becomes `paid`.
2. Staff (`admin`) opens Orders and clicks **Mark ready** on that order — it becomes `ready`.
3. The customer returns, opens Orders, and enters the order's ID (the short `#xxxxxxxx` id shown in the list) into the **Order pickup** panel — the order becomes `picked-up`.

The pickup lookup accepts the short id prefix shown in the UI, not just the full order id.

Use the "Sign out" button in the header to switch accounts.

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

Before submitting, replace both deployment entries above with the live frontend URLs and verify that each frontend points to its deployed backend through `VITE_API_URL` or `NEXT_PUBLIC_API_URL`. A GitHub repository alone does not satisfy the assessment.

## Database change workflow

Database changes are tracked as SQL migrations and documentation updates together.

1. Append the next numbered section to `backend/database/migrations/001_initial_schema.sql`, for example `-- 003: Add customers`.
2. Put the complete SQL change under that section.
3. Add a matching heading to that backend's `database/README.md` describing the change and its rollback or data-safety considerations.
4. Update the backend code in the same change when the schema contract changes.
5. Test the migration against the shared Supabase project before deploying.

Both backends execute the consolidated `001_initial_schema.sql` file on startup and query their own table names from the shared Supabase project.
