# Task 01 POS

React/Vite POS interface backed by Express. The backend reserves inventory before payment and has PostgreSQL transactions for production.

## Run

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Set `VITE_API_URL` when the API is deployed somewhere other than `http://localhost:4001/api`.

## Accounts and login

The app is gated behind real sign-in backed by the `users` table (see `backend/database/README.md`, change 005). Passwords are hashed server-side (Node `crypto.scrypt`) — never stored in plaintext. Anyone can self-register from the login screen; self-registration always creates role `user`. A demo `admin` account is seeded by the migration:

| Role | Username | Password | Access |
| --- | --- | --- | --- |
| Admin (seeded) | `admin` | `admin` | Staff view — Manage catalog, view all orders, mark paid orders "ready". Cannot shop; cart is hidden. |
| User (register your own) | — | — | Shop and checkout. Pick up a "ready" order by entering its order ID on the Orders page. No catalog management. |

Each account's cart and order history are personal (see `backend/database/README.md`, change 006): the cart lives in `users.cart` and persists across login/logout, and `GET /api/orders` only returns the signed-in account's own orders — admin is the only role that sees everyone's.

## Test manually

Register a new account (defaults to `user`), add products, reserve checkout, approve/fail/timeout payment, refresh inventory, and run `cd backend && npm test` to exercise concurrent reservations.

As `admin`, mark a `paid` order "ready" from the Orders page. As the registered user, enter that order's id (the short `#xxxxxxxx` shown in the list) into the pickup panel on Orders to move it to `picked-up`.
