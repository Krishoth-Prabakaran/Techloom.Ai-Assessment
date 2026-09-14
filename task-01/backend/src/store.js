import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const { Pool } = pg;
const seed = [
  { id: 'coffee-beans', name: 'Single Origin Coffee', price: 18.5, stock: 8 },
  { id: 'ceramic-mug', name: 'Hand-thrown Ceramic Mug', price: 24, stock: 12 },
  { id: 'linen-apron', name: 'Washed Linen Apron', price: 42, stock: 5 }
];

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const suppliedBuffer = scryptSync(password, salt, 64);
  return hashBuffer.length === suppliedBuffer.length && timingSafeEqual(hashBuffer, suppliedBuffer);
}

export class InventoryStore {
  constructor() {
    this.pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined }) : null;
    this.products = new Map(seed.map((product) => [product.id, { ...product }]));
    this.orders = new Map();
    this.users = new Map([['admin', { id: crypto.randomUUID(), username: 'admin', passwordHash: hashPassword('admin'), role: 'admin', cart: [] }]]);
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

  async registerUser(username, password) {
    if (!username || !password) throw new Error('INVALID_CREDENTIALS');
    if (this.pool) {
      const id = crypto.randomUUID();
      try {
        const result = await this.pool.query('INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role', [id, username, hashPassword(password), 'user']);
        return result.rows[0];
      } catch (error) { if (error.code === '23505') throw new Error('USERNAME_TAKEN'); throw error; }
    }
    if (this.users.has(username)) throw new Error('USERNAME_TAKEN');
    const user = { id: crypto.randomUUID(), username, passwordHash: hashPassword(password), role: 'user', cart: [] };
    this.users.set(username, user);
    return { id: user.id, username: user.username, role: user.role };
  }

  findUserById(id) {
    for (const user of this.users.values()) if (user.id === id) return user;
    return null;
  }

  async getCart(userId) {
    if (this.pool) {
      const result = await this.pool.query('SELECT cart FROM users WHERE id = $1', [userId]);
      if (!result.rowCount) throw new Error('NOT_FOUND');
      return result.rows[0].cart || [];
    }
    const user = this.findUserById(userId);
    if (!user) throw new Error('NOT_FOUND');
    return user.cart || [];
  }

  async saveCart(userId, items) {
    if (this.pool) {
      const result = await this.pool.query('UPDATE users SET cart = $1 WHERE id = $2 RETURNING cart', [JSON.stringify(items), userId]);
      if (!result.rowCount) throw new Error('NOT_FOUND');
      return result.rows[0].cart;
    }
    const user = this.findUserById(userId);
    if (!user) throw new Error('NOT_FOUND');
    user.cart = items;
    return user.cart;
  }

  async authenticate(username, password) {
    if (this.pool) {
      const result = await this.pool.query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
      const user = result.rows[0];
      if (!user || !verifyPassword(password, user.password_hash)) throw new Error('INVALID_CREDENTIALS');
      return { id: user.id, username: user.username, role: user.role };
    }
    const user = this.users.get(username);
    if (!user || !verifyPassword(password, user.passwordHash)) throw new Error('INVALID_CREDENTIALS');
    return { id: user.id, username: user.username, role: user.role };
  }

  async listProducts() { return this.pool ? (await this.pool.query('SELECT id, name, price::float, stock, image_url AS "imageUrl" FROM products ORDER BY name')).rows : [...this.products.values()]; }
  async getProduct(id) { return (await this.listProducts()).find((product) => product.id === id); }

  async listOrders(requesterId) {
    const requester = this.pool
      ? (await this.pool.query('SELECT id, role FROM users WHERE id = $1', [requesterId])).rows[0]
      : this.findUserById(requesterId);
    const isAdmin = requester?.role === 'admin';
    if (this.pool) {
      if (isAdmin) return (await this.pool.query('SELECT id, status, items, total::float, expires_at AS "expiresAt", created_at AS "createdAt" FROM orders ORDER BY created_at DESC')).rows;
      if (!requester) return [];
      return (await this.pool.query('SELECT id, status, items, total::float, expires_at AS "expiresAt", created_at AS "createdAt" FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [requesterId])).rows;
    }
    const all = [...new Set(this.orders.values())];
    if (isAdmin) return all;
    if (!requester) return [];
    return all.filter((order) => order.userId === requesterId);
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

  async reserve(items, paymentKey, userId) {
    if (this.pool) return this.reservePostgres(items, paymentKey, userId);
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
    const order = { id, status: 'reserved', items: lines, total, expiresAt: Date.now() + 5 * 60 * 1000, paymentKey, userId: userId || null };
    this.orders.set(paymentKey, order); this.orders.set(id, order); return order;
  }

  async reservePostgres(items, paymentKey, userId) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN');
      const lines = []; let total = 0;
      for (const item of items) {
        const result = await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, price::float, stock', [item.quantity, item.productId]);
        if (!result.rowCount) throw new Error('INSUFFICIENT_STOCK');
        lines.push({ ...result.rows[0], quantity: item.quantity }); total += result.rows[0].price * item.quantity;
      }
      const id = crypto.randomUUID();
      const result = await client.query('INSERT INTO orders (id, status, items, total, expires_at, payment_key, user_id) VALUES ($1, $2, $3, $4, NOW() + interval \'5 minutes\', $5, $6) RETURNING id, status, items, total::float, expires_at', [id, 'reserved', JSON.stringify(lines), total, paymentKey, userId || null]);
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

  findByIdPrefix(prefix) {
    let match = null;
    for (const [key, order] of this.orders) {
      if (key !== order.id || !order.id.startsWith(prefix)) continue;
      if (!match || order.id === prefix) match = order;
    }
    return match;
  }

  async markReady(idOrPrefix) {
    if (this.pool) return this.markReadyPostgres(idOrPrefix);
    const order = this.findByIdPrefix(idOrPrefix);
    if (!order) throw new Error('NOT_FOUND');
    if (order.status !== 'paid') throw new Error('INVALID_TRANSITION');
    order.status = 'ready'; return order;
  }

  async markReadyPostgres(idOrPrefix) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query("SELECT id, status FROM orders WHERE id::text LIKE $1 || '%' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [idOrPrefix]);
      if (!found.rowCount) throw new Error('NOT_FOUND');
      if (found.rows[0].status !== 'paid') throw new Error('INVALID_TRANSITION');
      const updated = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status, items, total::float, expires_at AS "expiresAt", created_at AS "createdAt"', ['ready', found.rows[0].id]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async pickup(idOrPrefix) {
    if (this.pool) return this.pickupPostgres(idOrPrefix);
    const order = this.findByIdPrefix(idOrPrefix);
    if (!order) throw new Error('NOT_FOUND');
    if (order.status !== 'ready') throw new Error('INVALID_TRANSITION');
    order.status = 'picked-up'; return order;
  }

  async pickupPostgres(idOrPrefix) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query("SELECT id, status FROM orders WHERE id::text LIKE $1 || '%' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [idOrPrefix]);
      if (!found.rowCount) throw new Error('NOT_FOUND');
      if (found.rows[0].status !== 'ready') throw new Error('INVALID_TRANSITION');
      const updated = await client.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status, items, total::float, expires_at AS "expiresAt", created_at AS "createdAt"', ['picked-up', found.rows[0].id]);
      await client.query('COMMIT'); return updated.rows[0];
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
