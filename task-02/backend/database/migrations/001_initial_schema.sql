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
