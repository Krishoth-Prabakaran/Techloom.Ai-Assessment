-- Task 01 / Migration 001
-- Creates POS inventory and order tables with demo products.

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'paid', 'cancelled', 'expired', 'failed')),
  items JSONB NOT NULL,
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  expires_at TIMESTAMPTZ,
  payment_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sample inventory rows for local/demo use.
INSERT INTO products (id, name, price, stock) VALUES
  ('coffee-beans', 'Single Origin Coffee', 18.50, 8),
  ('ceramic-mug', 'Hand-thrown Ceramic Mug', 24.00, 12),
  ('linen-apron', 'Washed Linen Apron', 42.00, 5)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 002: Enable Row Level Security
-- Protect POS tables from direct Supabase anon/authenticated access.
-- The Express backend connects server-side through PostgreSQL.

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 003: Add product images
-- Stores an optional image URL managed from the database.

ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ============================================================
-- 004: Add pickup workflow statuses
-- Staff mark a paid order "ready"; the customer then redeems it with the
-- order id at the counter, which marks it "picked-up".

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('reserved', 'paid', 'ready', 'picked-up', 'cancelled', 'expired', 'failed'));

-- ============================================================
-- 005: Add users table for real registration/login
-- Every self-registered account defaults to role 'user'; 'admin' is not
-- assignable through the public register endpoint. A demo admin account
-- (admin / admin) is seeded below so staff features stay reachable in a
-- fresh database. password_hash stores "salt:hash" from Node's scrypt.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

INSERT INTO users (id, username, password_hash, role) VALUES
  ('a3f1c9b2-6b7b-4a86-9e46-3f2b8c1d0e11', 'admin', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:110094ffe2747f901fda13c5a5010a6c81e81e3c7dfc0d84f3d1229266ec200c6bb2e2cb52e8a13c4768c2647e70ac675acde420f7fecf5b43bf96138d05344c', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 006: Personal carts and per-user order visibility
-- Each account gets its own cart that persists across login/logout
-- (and across devices), instead of living only in the browser. Orders are
-- now tied to the account that placed them, so a user only ever sees their
-- own order history; staff (admin) still see every order to fulfill them.

ALTER TABLE users ADD COLUMN IF NOT EXISTS cart JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
