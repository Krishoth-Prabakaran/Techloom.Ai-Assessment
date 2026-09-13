import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import cors from 'cors';

const { Pool } = pg;
const app = express();
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined }) : null;
const products = [{ id: 'field-jacket', name: 'Field Jacket', category: 'Outerwear', price: 148, description: 'A weather-ready layer cut from dry waxed cotton.', stock: 7, accent: '#6e7f5d' }, { id: 'studio-lamp', name: 'Studio Lamp', category: 'Objects', price: 86, description: 'Soft, directional light in a spun metal shade.', stock: 4, accent: '#c58e45' }, { id: 'travel-notebook', name: 'Travel Notebook', category: 'Paper', price: 22, description: 'Recycled cotton paper with a cloth-bound spine.', stock: 18, accent: '#a9a38b' }, { id: 'canvas-tote', name: 'Canvas Tote', category: 'Carry', price: 34, description: 'A generous everyday carry with reinforced handles.', stock: 11, accent: '#b76d55' }];
const orders = []; const sessions = new Map();
const find = (id) => products.find((item) => item.id === id); const error = (res, message, status = 400) => res.status(status).json({ error: message });

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

async function checkoutDatabase(items, sessionKey) {
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
		await client.query('INSERT INTO store_orders (id, status, total, session_key) VALUES ($1, $2, $3, $4)', [orderId, 'reserved', total, sessionKey]);
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

async function cancelDatabaseOrder(id) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await client.query('SELECT id, status, total::float, session_key AS "sessionKey", created_at AS "createdAt" FROM store_orders WHERE id = $1 FOR UPDATE', [id]);
		if (!result.rowCount) throw new Error('NOT_FOUND');
		const order = result.rows[0]; if (!['reserved', 'paid'].includes(order.status)) throw new Error('INVALID_TRANSITION');
		const itemResult = await client.query('SELECT i.product_id AS id, p.name, p.category, p.description, p.accent, i.quantity, i.unit_price::float AS price FROM store_order_items i JOIN store_products p ON p.id = i.product_id WHERE i.order_id = $1', [id]);
		if (order.status === 'reserved') for (const item of itemResult.rows) await client.query('UPDATE store_products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.id]);
		await client.query('UPDATE store_orders SET status = \'cancelled\' WHERE id = $1', [id]);
		await client.query('INSERT INTO store_refunds (id, order_id) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING', [crypto.randomUUID(), id]);
		await client.query('COMMIT'); return { ...order, status: 'cancelled', refund: 'simulated-refund-issued', items: itemResult.rows };
	} catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

app.use(cors()); app.use(express.json());
app.get('/health', async (_, res) => res.json({ ok: true, database: Boolean(pool) }));
app.get('/api/products', async (req, res) => { try { res.json(await listProducts((req.query.q || '').toLowerCase(), req.query.category || '')); } catch (error) { res.status(503).json({ error: 'DATABASE_UNAVAILABLE', detail: error.message }); } });
app.post('/api/products', async (req, res) => { try { if (pool) { const result = await pool.query('INSERT INTO store_products (id, name, category, price, description, stock, accent, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, category, price::float, description, stock, accent, image_url AS "imageUrl"', [req.body.id, req.body.name, req.body.category, req.body.price, req.body.description, req.body.stock, req.body.accent || '#68765a', req.body.imageUrl || null]); return res.status(201).json(result.rows[0]); } const product = { ...req.body, accent: req.body.accent || '#68765a' }; products.push(product); res.status(201).json(product); } catch (error) { res.status(400).json({ error: error.message }); } });
app.patch('/api/products/:id', async (req, res) => { try { if (pool) { const result = await pool.query('UPDATE store_products SET name = $1, category = $2, price = $3, description = $4, stock = $5, accent = $6, image_url = $7 WHERE id = $8 RETURNING id, name, category, price::float, description, stock, accent, image_url AS "imageUrl"', [req.body.name, req.body.category, req.body.price, req.body.description, req.body.stock, req.body.accent, req.body.imageUrl || null, req.params.id]); if (!result.rowCount) return error(res, 'NOT_FOUND', 404); return res.json(result.rows[0]); } const index = products.findIndex((product) => product.id === req.params.id); if (index < 0) return error(res, 'NOT_FOUND', 404); products[index] = { ...products[index], ...req.body }; res.json(products[index]); } catch (error) { res.status(400).json({ error: error.message }); } });
app.delete('/api/products/:id', async (req, res) => { try { if (pool) { const result = await pool.query('DELETE FROM store_products WHERE id = $1 RETURNING id', [req.params.id]); if (!result.rowCount) return error(res, 'NOT_FOUND', 404); return res.json({ id: req.params.id, deleted: true }); } const index = products.findIndex((product) => product.id === req.params.id); if (index < 0) return error(res, 'NOT_FOUND', 404); products.splice(index, 1); res.json({ id: req.params.id, deleted: true }); } catch (error) { res.status(error.code === '23503' ? 409 : 400).json({ error: error.code === '23503' ? 'PRODUCT_IN_USE' : error.message }); } });
app.get('/api/orders', async (_, res) => { if (pool) return res.json((await pool.query('SELECT o.id, o.status, o.total::float, o.session_key AS "sessionKey", o.created_at AS "createdAt", COALESCE(json_agg(json_build_object(\'id\', i.product_id, \'name\', p.name, \'quantity\', i.quantity, \'price\', i.unit_price::float)) FILTER (WHERE i.product_id IS NOT NULL), \'[]\') AS items FROM store_orders o LEFT JOIN store_order_items i ON i.order_id = o.id LEFT JOIN store_products p ON p.id = i.product_id GROUP BY o.id ORDER BY o.created_at DESC')).rows); res.json(orders); });
app.post('/api/checkout', async (req, res) => { try { if (pool) return res.status(201).json(await checkoutDatabase(req.body.items, req.body.sessionKey)); const { items, sessionKey } = req.body; if (sessions.has(sessionKey)) return error(res, 'DUPLICATE_CHECKOUT', 409); const lines = []; for (const item of items) { const product = find(item.productId); if (!product || product.stock < item.quantity) return error(res, 'INSUFFICIENT_STOCK', 409); lines.push({ ...product, quantity: item.quantity }); } lines.forEach((line) => { find(line.id).stock -= line.quantity; }); const order = { id: crypto.randomUUID(), status: 'reserved', items: lines, total: lines.reduce((total, line) => total + line.price * line.quantity, 0), sessionKey, createdAt: new Date().toISOString() }; orders.unshift(order); sessions.set(sessionKey, order); res.status(201).json(order); } catch (error) { error.message === 'DUPLICATE_CHECKOUT' || error.message === 'INSUFFICIENT_STOCK' ? res.status(409).json({ error: error.message }) : res.status(500).json({ error: error.message }); } });
app.post('/api/orders/:id/pay', async (req, res) => { try { if (pool) return res.json(await updateDatabasePayment(req.params.id, req.body.outcome)); const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (order.status !== 'reserved') return error(res, 'DUPLICATE_PAYMENT', 409); if (req.body.outcome !== 'success') { order.items.forEach((line) => { find(line.id).stock += line.quantity; }); order.status = req.body.outcome === 'timeout' ? 'expired' : 'failed'; } else order.status = 'paid'; res.json(order); } catch (error) { res.status(error.message === 'DUPLICATE_PAYMENT' ? 409 : error.message === 'NOT_FOUND' ? 404 : 500).json({ error: error.message }); } });
app.post('/api/orders/:id/cancel', async (req, res) => { try { if (pool) return res.json(await cancelDatabaseOrder(req.params.id)); const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (!['paid', 'reserved'].includes(order.status)) return error(res, 'INVALID_TRANSITION'); if (order.status === 'reserved') order.items.forEach((line) => { find(line.id).stock += line.quantity; }); order.status = 'cancelled'; order.refund = 'simulated-refund-issued'; res.json(order); } catch (error) { res.status(error.message === 'NOT_FOUND' ? 404 : error.message === 'INVALID_TRANSITION' ? 400 : 500).json({ error: error.message }); } });

const port = process.env.PORT || 4002;
initDatabase().then(() => app.listen(port, () => console.log(`Task 02 API listening on ${port}`))).catch((error) => { console.error(`Database initialization failed: ${error.message}`); process.exitCode = 1; });
