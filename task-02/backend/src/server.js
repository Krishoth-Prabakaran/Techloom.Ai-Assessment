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
		const result = await pool.query(`SELECT id, name, category, price::float, description, stock, accent FROM store_products WHERE ($1 = '' OR LOWER(name || ' ' || description) LIKE '%' || LOWER($1) || '%') AND ($2 = '' OR category = $2) ORDER BY name`, [query, category]);
		return result.rows;
	}
	return products.filter((product) => (!query || `${product.name} ${product.description}`.toLowerCase().includes(query)) && (!category || product.category === category));
}

app.use(cors()); app.use(express.json());
app.get('/health', async (_, res) => res.json({ ok: true, database: Boolean(pool) }));
app.get('/api/products', async (req, res) => { try { res.json(await listProducts((req.query.q || '').toLowerCase(), req.query.category || '')); } catch (error) { res.status(503).json({ error: 'DATABASE_UNAVAILABLE', detail: error.message }); } });
app.get('/api/orders', (_, res) => res.json(orders));
app.post('/api/checkout', (req, res) => { const { items, sessionKey } = req.body; if (sessions.has(sessionKey)) return error(res, 'DUPLICATE_CHECKOUT', 409); const lines = []; for (const item of items) { const product = find(item.productId); if (!product || product.stock < item.quantity) return error(res, 'INSUFFICIENT_STOCK', 409); lines.push({ ...product, quantity: item.quantity }); } lines.forEach((line) => { find(line.id).stock -= line.quantity; }); const order = { id: crypto.randomUUID(), status: 'reserved', items: lines, total: lines.reduce((total, line) => total + line.price * line.quantity, 0), sessionKey, createdAt: new Date().toISOString() }; orders.unshift(order); sessions.set(sessionKey, order); res.status(201).json(order); });
app.post('/api/orders/:id/pay', (req, res) => { const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (order.status !== 'reserved') return error(res, 'DUPLICATE_PAYMENT', 409); if (req.body.outcome !== 'success') { order.items.forEach((line) => { find(line.id).stock += line.quantity; }); order.status = req.body.outcome === 'timeout' ? 'expired' : 'failed'; } else order.status = 'paid'; res.json(order); });
app.post('/api/orders/:id/cancel', (req, res) => { const order = orders.find((item) => item.id === req.params.id); if (!order) return error(res, 'NOT_FOUND', 404); if (!['paid', 'reserved'].includes(order.status)) return error(res, 'INVALID_TRANSITION'); if (order.status === 'reserved') order.items.forEach((line) => { find(line.id).stock += line.quantity; }); order.status = 'cancelled'; order.refund = 'simulated-refund-issued'; res.json(order); });

const port = process.env.PORT || 4002;
initDatabase().then(() => app.listen(port, () => console.log(`Task 02 API listening on ${port}`))).catch((error) => { console.error(`Database initialization failed: ${error.message}`); process.exitCode = 1; });
