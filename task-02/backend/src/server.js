import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import cors from 'cors';

const { Pool } = pg;
const app = express();
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined }) : null;
const products = [{ id: 'field-jacket', name: 'Field Jacket', category: 'Outerwear', price: 148, description: 'A weather-ready layer cut from dry waxed cotton.', stock: 7, accent: '#6e7f5d' }, { id: 'studio-lamp', name: 'Studio Lamp', category: 'Objects', price: 86, description: 'Soft, directional light in a spun metal shade.', stock: 4, accent: '#c58e45' }, { id: 'travel-notebook', name: 'Travel Notebook', category: 'Paper', price: 22, description: 'Recycled cotton paper with a cloth-bound spine.', stock: 18, accent: '#a9a38b' }, { id: 'canvas-tote', name: 'Canvas Tote', category: 'Carry', price: 34, description: 'A generous everyday carry with reinforced handles.', stock: 11, accent: '#b76d55' }];
const orders = []; const sessions = new Map();
const find = (id) => products.find((item) => item.id === id); const error = (res, message, status = 400) => res.status(status).json({ error: message });

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

const users = new Map([['admin', { id: crypto.randomUUID(), username: 'admin', passwordHash: hashPassword('admin'), role: 'admin', cart: [] }]]);
const findUserById = (id) => { for (const user of users.values()) if (user.id === id) return user; return null; };

async function registerUser(username, password) {
	if (!username || !password) throw new Error('INVALID_CREDENTIALS');
	if (pool) {
		const id = crypto.randomUUID();
		try {
			const result = await pool.query('INSERT INTO store_users (id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role', [id, username, hashPassword(password), 'user']);
			return result.rows[0];
		} catch (err) { if (err.code === '23505') throw new Error('USERNAME_TAKEN'); throw err; }
	}
	if (users.has(username)) throw new Error('USERNAME_TAKEN');
	const user = { id: crypto.randomUUID(), username, passwordHash: hashPassword(password), role: 'user', cart: [] };
	users.set(username, user);
	return { id: user.id, username: user.username, role: user.role };
}

async function authenticate(username, password) {
	if (pool) {
		const result = await pool.query('SELECT id, username, password_hash, role FROM store_users WHERE username = $1', [username]);
		const user = result.rows[0];
		if (!user || !verifyPassword(password, user.password_hash)) throw new Error('INVALID_CREDENTIALS');
		return { id: user.id, username: user.username, role: user.role };
	}
	const user = users.get(username);
	if (!user || !verifyPassword(password, user.passwordHash)) throw new Error('INVALID_CREDENTIALS');
	return { id: user.id, username: user.username, role: user.role };
}

async function getCart(userId) {
	if (pool) {
		const result = await pool.query('SELECT cart FROM store_users WHERE id = $1', [userId]);
		if (!result.rowCount) throw new Error('NOT_FOUND');
		return result.rows[0].cart || [];
	}
	const user = findUserById(userId);
	if (!user) throw new Error('NOT_FOUND');
	return user.cart || [];
}

async function saveCart(userId, items) {
	if (pool) {
		const result = await pool.query('UPDATE store_users SET cart = $1 WHERE id = $2 RETURNING cart', [JSON.stringify(items), userId]);
		if (!result.rowCount) throw new Error('NOT_FOUND');
		return result.rows[0].cart;
	}
	const user = findUserById(userId);
	if (!user) throw new Error('NOT_FOUND');
	user.cart = items;
	return user.cart;
}

async function listOrdersFor(requesterId) {
	const requester = pool
		? (await pool.query('SELECT id, role FROM store_users WHERE id = $1', [requesterId])).rows[0]
		: findUserById(requesterId);
	const isAdmin = requester?.role === 'admin';
	if (pool) {
		if (isAdmin) return (await pool.query('SELECT o.id, o.status, o.total::float, o.session_key AS "sessionKey", o.created_at AS "createdAt", COALESCE(json_agg(json_build_object(\'id\', i.product_id, \'name\', p.name, \'quantity\', i.quantity, \'price\', i.unit_price::float)) FILTER (WHERE i.product_id IS NOT NULL), \'[]\') AS items FROM store_orders o LEFT JOIN store_order_items i ON i.order_id = o.id LEFT JOIN store_products p ON p.id = i.product_id GROUP BY o.id ORDER BY o.created_at DESC')).rows;
		if (!requester) return [];
		return (await pool.query('SELECT o.id, o.status, o.total::float, o.session_key AS "sessionKey", o.created_at AS "createdAt", COALESCE(json_agg(json_build_object(\'id\', i.product_id, \'name\', p.name, \'quantity\', i.quantity, \'price\', i.unit_price::float)) FILTER (WHERE i.product_id IS NOT NULL), \'[]\') AS items FROM store_orders o LEFT JOIN store_order_items i ON i.order_id = o.id LEFT JOIN store_products p ON p.id = i.product_id WHERE o.user_id = $1 GROUP BY o.id ORDER BY o.created_at DESC', [requesterId])).rows;
	}
	if (isAdmin) return orders;
	if (!requester) return [];
	return orders.filter((order) => order.userId === requesterId);
}

async function expireReservations() {
	if (!pool) {
		const now = Date.now();
		for (const order of orders) {
			if (order.status !== 'reserved' || new Date(order.expiresAt).getTime() > now) continue;
			order.items.forEach((line) => { const product = find(line.id); if (product) product.stock += line.quantity; });
			order.status = 'expired';
		}
		return;
	}
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query('SELECT id FROM store_orders WHERE status = $1 AND created_at <= NOW() - interval \'5 minutes\' FOR UPDATE', ['reserved']);
		for (const order of result.rows) {
			const items = await client.query('SELECT product_id, quantity FROM store_order_items WHERE order_id = $1', [order.id]);
			for (const item of items.rows) await client.query('UPDATE store_products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
			await client.query('UPDATE store_orders SET status = $1 WHERE id = $2', ['expired', order.id]);
		}
		await client.query('COMMIT');
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function initDatabase() {
	if (!pool) return;
	const migration = await readFile(new URL('../database/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
	await pool.query(migration);
}

async function listProducts(query, category) {
	if (pool) {
		const result = await pool.query(`SELECT id, name, category, price::float, description, stock, accent, image_url AS "imageUrl" FROM store_products WHERE ($1 = '' OR LOWER(name || ' ' || description) LIKE '%' || LOWER($1) || '%') AND ($2 = '' OR category = $2) ORDER BY name`, [query, category]);
		return result.rows;
	}
	return products.filter((product) => (!query || `${product.name} ${product.description}`.toLowerCase().includes(query)) && (!category || product.category === category));
}

async function getDatabaseProduct(id, client = pool) {
	const result = await client.query('SELECT id, name, category, price::float, description, stock, accent, image_url AS "imageUrl" FROM store_products WHERE id = $1', [id]);
	return result.rows[0];
}

async function checkoutDatabase(items, sessionKey, userId) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const existing = await client.query('SELECT id FROM store_orders WHERE session_key = $1', [sessionKey]);
		if (existing.rowCount) throw new Error('DUPLICATE_CHECKOUT');
		const lines = []; let total = 0;
		for (const item of items) {
			const productResult = await client.query('UPDATE store_products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, name, category, price::float, description, stock, accent, image_url AS "imageUrl"', [item.quantity, item.productId]);
			if (!productResult.rowCount) throw new Error('INSUFFICIENT_STOCK');
			const product = productResult.rows[0]; lines.push({ ...product, quantity: item.quantity }); total += product.price * item.quantity;
		}
		const orderId = crypto.randomUUID();
		await client.query('INSERT INTO store_orders (id, status, total, session_key, user_id) VALUES ($1, $2, $3, $4, $5)', [orderId, 'reserved', total, sessionKey, userId || null]);
		for (const item of lines) await client.query('INSERT INTO store_order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)', [orderId, item.id, item.quantity, item.price]);
		await client.query('COMMIT'); return { id: orderId, status: 'reserved', items: lines, total, sessionKey, createdAt: new Date().toISOString() };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function updateDatabasePayment(id, outcome) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query('SELECT id, status, total::float, session_key AS "sessionKey", created_at AS "createdAt" FROM store_orders WHERE id = $1 FOR UPDATE', [id]);
		if (!result.rowCount) throw new Error('NOT_FOUND');
		const order = result.rows[0]; if (order.status !== 'reserved') throw new Error('DUPLICATE_PAYMENT');
		const itemResult = await client.query('SELECT i.product_id AS id, p.name, p.category, p.description, p.accent, i.quantity, i.unit_price::float AS price FROM store_order_items i JOIN store_products p ON p.id = i.product_id WHERE i.order_id = $1', [id]);
		const status = outcome === 'success' ? 'paid' : outcome === 'timeout' ? 'expired' : 'failed';
		if (status !== 'paid') for (const item of itemResult.rows) await client.query('UPDATE store_products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
		await client.query('UPDATE store_orders SET status = $1 WHERE id = $2', [status, id]);
		await client.query('INSERT INTO store_payments (id, order_id, outcome) VALUES ($1, $2, $3)', [crypto.randomUUID(), id, outcome]);
		await client.query('COMMIT'); return { ...order, status, items: itemResult.rows };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function markReadyDatabase(idOrPrefix) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const found = await client.query("SELECT id, status, total::float, session_key AS \"sessionKey\", created_at AS \"createdAt\" FROM store_orders WHERE id::text LIKE $1 || '%' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [idOrPrefix]);
		if (!found.rowCount) throw new Error('NOT_FOUND');
		const order = found.rows[0];
		if (order.status !== 'paid') throw new Error('INVALID_TRANSITION');
		const itemResult = await client.query('SELECT i.product_id AS id, p.name, p.category, p.description, p.accent, i.quantity, i.unit_price::float AS price FROM store_order_items i JOIN store_products p ON p.id = i.product_id WHERE i.order_id = $1', [order.id]);
		await client.query('UPDATE store_orders SET status = $1 WHERE id = $2', ['ready', order.id]);
		await client.query('COMMIT'); return { ...order, status: 'ready', items: itemResult.rows };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function pickupDatabase(idOrPrefix) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const found = await client.query("SELECT id, status, total::float, session_key AS \"sessionKey\", created_at AS \"createdAt\" FROM store_orders WHERE id::text LIKE $1 || '%' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [idOrPrefix]);
		if (!found.rowCount) throw new Error('NOT_FOUND');
		const order = found.rows[0];
		if (order.status !== 'ready') throw new Error('INVALID_TRANSITION');
		const itemResult = await client.query('SELECT i.product_id AS id, p.name, p.category, p.description, p.accent, i.quantity, i.unit_price::float AS price FROM store_order_items i JOIN store_products p ON p.id = i.product_id WHERE i.order_id = $1', [order.id]);
		await client.query('UPDATE store_orders SET status = $1 WHERE id = $2', ['picked-up', order.id]);
		await client.query('COMMIT'); return { ...order, status: 'picked-up', items: itemResult.rows };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function cancelDatabaseOrder(id) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query('SELECT id, status, total::float, session_key AS "sessionKey", created_at AS "createdAt" FROM store_orders WHERE id = $1 FOR UPDATE', [id]);
		if (!result.rowCount) throw new Error('NOT_FOUND');
		const order = result.rows[0]; if (!['reserved', 'paid'].includes(order.status)) throw new Error('INVALID_TRANSITION');
		const itemResult = await client.query('SELECT i.product_id AS id, p.name, p.category, p.description, p.accent, i.quantity, i.unit_price::float AS price FROM store_order_items i JOIN store_products p ON p.id = i.product_id WHERE i.order_id = $1', [id]);
		if (['reserved', 'paid'].includes(order.status)) for (const item of itemResult.rows) await client.query('UPDATE store_products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
		await client.query('UPDATE store_orders SET status = \'cancelled\' WHERE id = $1', [id]);
		await client.query('INSERT INTO store_refunds (id, order_id) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING', [crypto.randomUUID(), id]);
		await client.query('COMMIT'); return { ...order, status: 'cancelled', refund: 'simulated-refund-issued', items: itemResult.rows };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

app.use(cors()); app.use(express.json());
app.get('/health', async (_, res) => res.json({ ok: true, database: Boolean(pool) }));
app.post('/api/auth/register', async (req, res) => { try { res.status(201).json(await registerUser(req.body.username, req.body.password)); } catch (err) { res.status(err.message === 'USERNAME_TAKEN' ? 409 : err.message === 'INVALID_CREDENTIALS' ? 400 : 500).json({ error: err.message }); } });
app.post('/api/auth/login', async (req, res) => { try { res.json(await authenticate(req.body.username, req.body.password)); } catch (err) { res.status(err.message === 'INVALID_CREDENTIALS' ? 401 : 500).json({ error: err.message }); } });
app.get('/api/products', async (req, res) => { try { res.json(await listProducts((req.query.q || '').toLowerCase(), req.query.category || '')); } catch (error) { res.status(503).json({ error: 'DATABASE_UNAVAILABLE', detail: error.message }); } });
app.post('/api/products', async (req, res) => { try { if (pool) { const result = await pool.query('INSERT INTO store_products (id, name, category, price, description, stock, accent, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, category, price::float, description, stock, accent, image_url AS "imageUrl"', [req.body.id, req.body.name, req.body.category, req.body.price, req.body.description, req.body.stock, req.body.accent || '#68765a', req.body.imageUrl || null]); return res.status(201).json(result.rows[0]); } const product = { ...req.body, accent: req.body.accent || '#68765a' }; products.push(product); res.status(201).json(product); } catch (error) { res.status(400).json({ error: error.message }); } });
app.patch('/api/products/:id', async (req, res) => { try { if (pool) { const result = await pool.query('UPDATE store_products SET name = $1, category = $2, price = $3, description = $4, stock = $5, accent = $6, image_url = $7 WHERE id = $8 RETURNING id, name, category, price::float, description, stock, accent, image_url AS "imageUrl"', [req.body.name, req.body.category, req.body.price, req.body.description, req.body.stock, req.body.accent, req.body.imageUrl || null, req.params.id]); if (!result.rowCount) return error(res, 'NOT_FOUND', 404); return res.json(result.rows[0]); } const index = products.findIndex((product) => product.id === req.params.id); if (index < 0) return error(res, 'NOT_FOUND', 404); products[index] = { ...products[index], ...req.body }; res.json(products[index]); } catch (error) { res.status(400).json({ error: error.message }); } });
app.delete('/api/products/:id', async (req, res) => { try { if (pool) { const result = await pool.query('DELETE FROM store_products WHERE id = $1 RETURNING id', [req.params.id]); if (!result.rowCount) return error(res, 'NOT_FOUND', 404); return res.json({ id: req.params.id, deleted: true }); } const index = products.findIndex((product) => product.id === req.params.id); if (index < 0) return error(res, 'NOT_FOUND', 404); products.splice(index, 1); res.json({ id: req.params.id, deleted: true }); } catch (error) { res.status(error.code === '23503' ? 409 : 400).json({ error: error.code === '23503' ? 'PRODUCT_IN_USE' : error.message }); } });
app.get('/api/orders', async (req, res) => { try { res.json(await listOrdersFor(req.query.userId)); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/cart', async (req, res) => { try { res.json(await getCart(req.query.userId)); } catch (err) { res.status(err.message === 'NOT_FOUND' ? 404 : 500).json({ error: err.message }); } });
app.put('/api/cart', async (req, res) => { try { res.json(await saveCart(req.body.userId, req.body.items || [])); } catch (err) { res.status(err.message === 'NOT_FOUND' ? 404 : 500).json({ error: err.message }); } });
app.post('/api/checkout', async (req, res) => { try { if (pool) return res.status(201).json(await checkoutDatabase(req.body.items, req.body.sessionKey, req.body.userId)); const { items, sessionKey, userId } = req.body; if (sessions.has(sessionKey)) return error(res, 'DUPLICATE_CHECKOUT', 409); const lines = []; for (const item of items) { const product = find(item.productId); if (!product || product.stock < item.quantity) return error(res, 'INSUFFICIENT_STOCK', 409); lines.push({ ...product, quantity: item.quantity }); } lines.forEach((line) => { find(line.id).stock -= line.quantity; }); const order = { id: crypto.randomUUID(), status: 'reserved', items: lines, total: lines.reduce((total, line) => total + line.price * line.quantity, 0), sessionKey, userId: userId || null, createdAt: new Date().toISOString() }; orders.unshift(order); sessions.set(sessionKey, order); res.status(201).json(order); } catch (error) { error.message === 'DUPLICATE_CHECKOUT' || error.message === 'INSUFFICIENT_STOCK' ? res.status(409).json({ error: error.message }) : res.status(500).json({ error: error.message }); } });
app.post('/api/orders/:id/pay', async (req, res) => { try { if (pool) return res.json(await updateDatabasePayment(req.params.id, req.body.outcome)); const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (order.status !== 'reserved') return error(res, 'DUPLICATE_PAYMENT', 409); if (req.body.outcome !== 'success') { order.items.forEach((line) => { find(line.id).stock += line.quantity; }); order.status = req.body.outcome === 'timeout' ? 'expired' : 'failed'; } else order.status = 'paid'; res.json(order); } catch (error) { res.status(error.message === 'DUPLICATE_PAYMENT' ? 409 : error.message === 'NOT_FOUND' ? 404 : 500).json({ error: error.message }); } });
app.post('/api/orders/:id/ready', async (req, res) => { try { if (pool) return res.json(await markReadyDatabase(req.params.id)); const order = orders.find((item) => item.id.startsWith(req.params.id)); if (!order) return error(res, 'NOT_FOUND', 404); if (order.status !== 'paid') return error(res, 'INVALID_TRANSITION'); order.status = 'ready'; res.json(order); } catch (error) { res.status(error.message === 'NOT_FOUND' ? 404 : error.message === 'INVALID_TRANSITION' ? 400 : 500).json({ error: error.message }); } });
app.post('/api/orders/:id/pickup', async (req, res) => { try { if (pool) return res.json(await pickupDatabase(req.params.id)); const order = orders.find((item) => item.id.startsWith(req.params.id)); if (!order) return error(res, 'NOT_FOUND', 404); if (order.status !== 'ready') return error(res, 'INVALID_TRANSITION'); order.status = 'picked-up'; res.json(order); } catch (error) { res.status(error.message === 'NOT_FOUND' ? 404 : error.message === 'INVALID_TRANSITION' ? 400 : 500).json({ error: error.message }); } });
app.post('/api/orders/:id/cancel', async (req, res) => { try { if (pool) return res.json(await cancelDatabaseOrder(req.params.id)); const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (!['paid', 'reserved'].includes(order.status)) return error(res, 'INVALID_TRANSITION'); order.items.forEach((line) => { const product = find(line.id); if (product) product.stock += line.quantity; }); order.status = 'cancelled'; order.refund = 'simulated-refund-issued'; res.json(order); } catch (error) { res.status(error.message === 'NOT_FOUND' ? 404 : error.message === 'INVALID_TRANSITION' ? 400 : 500).json({ error: error.message }); } });

const port = process.env.PORT || 4002;
initDatabase().then(() => { const expiryTimer = setInterval(() => expireReservations().catch(() => {}), 1000); expiryTimer.unref?.(); app.listen(port, () => console.log(`Task 02 API listening on ${port}`)); }).catch((error) => { console.error(`Database initialization failed: ${error.message}`); process.exitCode = 1; });
