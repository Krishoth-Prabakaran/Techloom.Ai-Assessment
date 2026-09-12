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
