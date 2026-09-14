# Task 02 Database Changes

All database changes are kept in `database/migrations/001_initial_schema.sql` in numbered sections.

## Migration 001: Initial schema

File: `migrations/001_initial_schema.sql`, section `001`

Creates separate storefront tables for products, orders, order items, payments, and refunds. The `store_` prefix prevents collisions with Task 01 when both projects share one Supabase database. It also seeds four sample catalog products for local/demo use.

## Change 002: Enable Row Level Security

File: `migrations/001_initial_schema.sql`, section `002`

Enables RLS on all storefront tables. No public policies are added because the client talks to the Express backend, not directly to Supabase.

## Change 003: Add product images

File: `migrations/001_initial_schema.sql`, section `003`

Adds nullable `store_products.image_url`. Existing rows are preserved, and image URLs can be updated directly in Supabase.

## Change 004: Add pickup workflow statuses

File: `migrations/001_initial_schema.sql`, section `004`

Widens the `store_orders.status` check constraint to also allow `ready` and `picked-up`. Staff mark a paid order `ready`; the customer then redeems it by order id, which transitions it to `picked-up`. Existing rows are unaffected since no prior status values are removed.

## Change 005: Add users table for registration/login

File: `migrations/001_initial_schema.sql`, section `005`

Creates `store_users` (`id`, `username` unique, `password_hash`, `role` defaulting to `user`, `created_at`) and enables RLS. The `store_` prefix keeps storefront accounts separate from Task 01's. Passwords are hashed with Node's `crypto.scrypt` and stored as `salt:hash`; the backend never stores plaintext passwords. The public `/api/auth/register` endpoint always creates `role = 'user'` — `admin` cannot be self-assigned. A demo admin row (`admin` / `admin`) is seeded with `ON CONFLICT (username) DO NOTHING` so staff features are reachable in a fresh database without manual setup.

## Change 006: Personal carts and per-user order visibility

File: `migrations/001_initial_schema.sql`, section `006`

Adds `store_users.cart` (JSONB, defaults to `[]`) so each account's bag persists server-side across login/logout instead of living only in the browser's `localStorage`. Adds `store_orders.user_id` (nullable, `ON DELETE SET NULL`) linking each order to the account that placed it. `GET /api/orders` now filters to the requester's own orders unless their role is `admin`, in which case every order is returned. Orders created before this migration have `user_id = NULL` and are only visible to `admin`.

## Required workflow

For every database change:

1. Append the next numbered SQL section to `migrations/001_initial_schema.sql`.
2. Describe the same numbered change in this README.
3. Update the application code in the same change if the schema contract changes.
4. Test the migration against the shared Supabase project before deployment.

