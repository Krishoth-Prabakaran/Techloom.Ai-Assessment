-- Task 02 / Migration 001
-- Creates storefront products, orders, payments, and refund records.

CREATE TABLE IF NOT EXISTS store_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  description TEXT NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  accent TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_orders (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'paid', 'cancelled', 'expired', 'failed')),
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
  session_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_order_items (
  order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES store_products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE IF NOT EXISTS store_payments (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES store_orders(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'timeout')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_refunds (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE REFERENCES store_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'simulated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sample catalog rows for local/demo use.
INSERT INTO store_products (id, name, category, price, description, stock, accent) VALUES
  ('field-jacket', 'Field Jacket', 'Outerwear', 148.00, 'A weather-ready layer cut from dry waxed cotton.', 7, '#6e7f5d'),
  ('studio-lamp', 'Studio Lamp', 'Objects', 86.00, 'Soft, directional light in a spun metal shade.', 4, '#c58e45'),
  ('travel-notebook', 'Travel Notebook', 'Paper', 22.00, 'Recycled cotton paper with a cloth-bound spine.', 18, '#a9a38b'),
  ('canvas-tote', 'Canvas Tote', 'Carry', 34.00, 'A generous everyday carry with reinforced handles.', 11, '#b76d55')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 002: Enable Row Level Security
-- Protect storefront tables from direct Supabase anon/authenticated access.
-- The Express backend connects server-side through PostgreSQL.

ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_refunds ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 003: Add product images
-- Stores an optional image URL managed from the database.

ALTER TABLE store_products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ============================================================
-- 004: Add pickup workflow statuses
-- Staff mark a paid order "ready"; the customer then redeems it with the
-- order id, which transitions it to "picked-up".

ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_status_check;
ALTER TABLE store_orders ADD CONSTRAINT store_orders_status_check CHECK (status IN ('reserved', 'paid', 'ready', 'picked-up', 'cancelled', 'expired', 'failed'));

-- ============================================================
-- 005: Add users table for real registration/login
-- The store_ prefix keeps storefront accounts separate from Task 01's
-- accounts in the shared Supabase project. Every self-registered account
-- defaults to role 'user'; 'admin' is not assignable through the public
-- register endpoint. A demo admin account (admin / admin) is seeded below
-- so staff features stay reachable in a fresh database. password_hash
-- stores "salt:hash" from Node's scrypt.

CREATE TABLE IF NOT EXISTS store_users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;

INSERT INTO store_users (id, username, password_hash, role) VALUES
  ('c4b2d8a1-9e5f-4c3a-8b7d-2e1f0a9c8b77', 'admin', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:110094ffe2747f901fda13c5a5010a6c81e81e3c7dfc0d84f3d1229266ec200c6bb2e2cb52e8a13c4768c2647e70ac675acde420f7fecf5b43bf96138d05344c', 'admin')
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 006: Personal carts and per-user order visibility
-- Each account gets its own bag that persists across login/logout (and
-- across devices), instead of living only in the browser. Orders are now
-- tied to the account that placed them, so a customer only ever sees their
-- own order history; staff (admin) still see every order to fulfill them.

ALTER TABLE store_users ADD COLUMN IF NOT EXISTS cart JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES store_users(id) ON DELETE SET NULL;
