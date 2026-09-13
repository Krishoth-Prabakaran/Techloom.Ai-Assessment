import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;
const seed = [
  { id: 'coffee-beans', name: 'Single Origin Coffee', price: 18.5, stock: 8 },
  { id: 'ceramic-mug', name: 'Hand-thrown Ceramic Mug', price: 24, stock: 12 },
  { id: 'linen-apron', name: 'Washed Linen Apron', price: 42, stock: 5 }
];

export class InventoryStore {
  constructor() {
    this.pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined }) : null;
    this.products = new Map(seed.map((product) => [product.id, { ...product }]));
    this.orders = new Map();
    this.expiryTimer = null;
  }

  async init() {
    if (this.pool) {
      const migration = await readFile(new URL('../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
      await this.pool.query(migration);
    }
    this.expiryTimer = setInterval(() => this.expireReservations().catch(() => {}), 1000);
    this.expiryTimer.unref?.();
  }

  async expireReservations() {
    if (!this.pool) {
      const now = Date.now();
      for (const [id, order] of this.orders) {
        if (id !== order.id || order.status !== 'reserved' || order.expiresAt > now) continue;
        order.items.forEach((line) => { const product = this.products.get(line.id); if (product) product.stock += line.quantity; });
        order.status = 'expired';
      }
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, items FROM orders WHERE status = $1 AND expires_at <= NOW() FOR UPDATE', ['reserved']);
      for (const order of result.rows) {
        for (const item of order.items) await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
        await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['expired', order.id]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async listProducts() { return this.pool ? (await this.pool.query('SELECT id, name, price::float, stock, image_url AS "imageUrl" FROM products ORDER BY name')).rows : [...this.products.values()]; }
  async getProduct(id) { return (await this.listProducts()).find((product) => product.id === id); }

  async listOrders() {
    if (this.pool) return (await this.pool.query('SELECT id, status, items, total::float, expires_at AS "expiresAt", created_at AS "createdAt" FROM orders ORDER BY created_at DESC')).rows;
    return [...new Set(this.orders.values())];
  }

  async createProduct(product) {
    if (this.pool) { const result = await this.pool.query('INSERT INTO products (id, name, price, stock, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, price::float, stock, image_url AS "imageUrl"', [product.id, product.name, product.price, product.stock, product.imageUrl || null]); return result.rows[0]; }
    const created = { ...product }; this.products.set(created.id, created); return created;
  }

  async updateProduct(id, product) {
    if (this.pool) { const result = await this.pool.query('UPDATE products SET name = $1, price = $2, stock = $3, image_url = $4 WHERE id = $5 RETURNING id, name, price::float, stock, image_url AS "imageUrl"', [product.name, product.price, product.stock, product.imageUrl || null, id]); if (!result.rowCount) throw new Error('NOT_FOUND'); return result.rows[0]; }
    if (!this.products.has(id)) throw new Error('NOT_FOUND'); const updated = { id, ...product }; this.products.set(id, updated); return updated;
  }

  async deleteProduct(id) {
    if (this.pool) { const result = await this.pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]); if (!result.rowCount) throw new Error('NOT_FOUND'); return { id, deleted: true }; }
    if (!this.products.delete(id)) throw new Error('NOT_FOUND'); return { id, deleted: true };
  }

  async reserve(items, paymentKey) {
    if (this.pool) return this.reservePostgres(items, paymentKey);
    if (this.orders.has(paymentKey)) throw new Error('DUPLICATE_ORDER');
    const lines = [];
    let total = 0;
    for (const item of items) {
      const product = this.products.get(item.productId);
      if (!product || product.stock < item.quantity) throw new Error('INSUFFICIENT_STOCK');
      lines.push({ ...product, quantity: item.quantity }); total += product.price * item.quantity;
    }
    lines.forEach((line) => { this.products.get(line.id).stock -= line.quantity; });
    const id = crypto.randomUUID();
    const order = { id, status: 'reserved', items: lines, total, expiresAt: Date.now() + 5 * 60 * 1000, paymentKey };
    this.orders.set(paymentKey, order); this.orders.set(id, order); return order;
  }

  async reservePostgres(items, paymentKey) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN');
      const lines = []; let total = 0;
      for (const item of items) {
        const result = await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, price::float, stock', [item.quantity, item.productId]);
        if (!result.rowCount) throw new Error('INSUFFICIENT_STOCK');
        lines.push({ ...result.rows[0], quantity: item.quantity }); total += result.rows[0].price * item.quantity;
      }
      const id = crypto.randomUUID();
      const result = await client.query('INSERT INTO orders (id, status, items, total, expires_at, payment_key) VALUES ($1, $2, $3, $4, NOW() + interval \'5 minutes\', $5) RETURNING id, status, items, total::float, expires_at', [id, 'reserved', JSON.stringify(lines), total, paymentKey]);
      await client.query('COMMIT'); return { ...result.rows[0], expiresAt: new Date(result.rows[0].expires_at).getTime() };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async pay(id, outcome) {
    if (this.pool) return this.payPostgres(id, outcome);
    const order = this.orders.get(id);
    if (!order) throw new Error('NOT_FOUND');
    if (order.status !== 'reserved') throw new Error('DUPLICATE_PAYMENT');
    if (Date.now() > order.expiresAt || outcome === 'timeout') return this.cancel(id, 'expired');
    if (outcome === 'failure') return this.cancel(id, 'failed');
    order.status = 'paid'; return order;
  }

  async payPostgres(id, outcome) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, status, items, total::float, expires_at AS "expiresAt" FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!result.rowCount) throw new Error('NOT_FOUND');
      const order = result.rows[0];
      if (order.status !== 'reserved') throw new Error('DUPLICATE_PAYMENT');
      const expired = new Date(order.expiresAt).getTime() < Date.now() || outcome === 'timeout';
      const status = expired ? 'expired' : outcome === 'failure' ? 'failed' : 'paid';
      if (status !== 'paid') {
        for (const item of order.items) await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
      }
      await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
      await client.query('COMMIT');
      return { ...order, status };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async cancel(id, status = 'cancelled') {
    if (this.pool) return this.cancelPostgres(id, status);
    const order = this.orders.get(id);
    if (!order) throw new Error('NOT_FOUND');
    if (!['reserved', 'paid'].includes(order.status)) throw new Error('INVALID_TRANSITION');
    if (['reserved', 'paid'].includes(order.status) || status !== 'cancelled') order.items.forEach((line) => { const product = this.products.get(line.id); if (product) product.stock += line.quantity; });
    order.status = status; return order;
  }

  async cancelPostgres(id, status = 'cancelled') {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id, status, items, total::float, expires_at AS "expiresAt" FROM orders WHERE id = $1 FOR UPDATE', [id]);
      if (!result.rowCount) throw new Error('NOT_FOUND');
      const order = result.rows[0];
      if (!['reserved', 'paid'].includes(order.status)) throw new Error('INVALID_TRANSITION');
      if (['reserved', 'paid'].includes(order.status) || status !== 'cancelled') for (const item of order.items) await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
      await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
      await client.query('COMMIT');
      return { ...order, status };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
