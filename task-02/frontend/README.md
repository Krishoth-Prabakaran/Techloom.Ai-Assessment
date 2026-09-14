# Task 02 Storefront

Next.js storefront with search, category filters, product details, cart checkout, successful/failed/timeout mock payments, cancellation with simulated refunds, catalog CRUD, and order history. The paired Express API owns stock and payment state.

## Run

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Set `NEXT_PUBLIC_API_URL` for a deployed API. The default is `http://localhost:4002/api`.

## Accounts and login

The app is gated behind real sign-in backed by the `store_users` table (see `backend/database/README.md`, change 005). Passwords are hashed server-side (Node `crypto.scrypt`) — never stored in plaintext. Anyone can self-register from the login screen; self-registration always creates role `user`. A demo `admin` account is seeded by the migration:

| Role | Username | Password | Access |
| --- | --- | --- | --- |
| Admin (seeded) | `admin` | `admin` | Staff view — Curate (catalog management), view all orders, mark paid orders "ready". Cannot shop; bag/checkout is hidden. |
| User (register your own) | — | — | Shop and checkout. Pick up a "ready" order by entering its order ID on the Orders page. No catalog management. |

As `admin`, mark a `paid` order "ready" from the Orders page. As the registered user, enter that order's id (the short `#xxxxxxxx` shown in the list) into the pickup panel on Orders to move it to `picked-up`.

Each account's bag and order history are personal (see `backend/database/README.md`, change 006): the bag lives in `store_users.cart` and persists across login/logout, and `GET /api/orders` only returns the signed-in account's own orders — admin is the only role that sees everyone's.
