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
  }

  async init() {
    if (!this.pool) return;
    const migration = await readFile(new URL('../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
    await this.pool.query(migration);
  }

  async listProducts() { return this.pool ? (await this.pool.query('SELECT id, name, price::float, stock, image_url AS "imageUrl" FROM products ORDER BY name')).rows : [...this.products.values()]; }
  async getProduct(id) { return (await this.listProducts()).find((product) => product.id === id); }

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
    const order = this.orders.get(id);
    if (!order) throw new Error('NOT_FOUND');
    if (order.status !== 'reserved') throw new Error('DUPLICATE_PAYMENT');
    if (Date.now() > order.expiresAt || outcome === 'timeout') return this.cancel(id, 'expired');
    if (outcome === 'failure') return this.cancel(id, 'failed');
    order.status = 'paid'; return order;
  }

  async cancel(id, status = 'cancelled') {
    const order = this.orders.get(id);
    if (!order) throw new Error('NOT_FOUND');
    if (!['reserved', 'paid'].includes(order.status)) throw new Error('INVALID_TRANSITION');
    if (order.status === 'reserved' || status !== 'cancelled') order.items.forEach((line) => { const product = this.products.get(line.id); if (product) product.stock += line.quantity; });
    order.status = status; return order;
  }
}
