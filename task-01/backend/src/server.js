import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { InventoryStore } from './store.js';

const app = express(); const store = new InventoryStore();
app.use(cors()); app.use(express.json());
const asyncRoute = (handler) => (req, res) => Promise.resolve(handler(req, res)).catch((error) => res.status(error.message === 'INSUFFICIENT_STOCK' ? 409 : error.message === 'DUPLICATE_PAYMENT' || error.message === 'DUPLICATE_ORDER' ? 409 : error.message === 'NOT_FOUND' ? 404 : 400).json({ error: error.message }));
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/api/products', asyncRoute(async (_, res) => res.json(await store.listProducts())));
app.post('/api/products', asyncRoute(async (req, res) => res.status(201).json(await store.createProduct(req.body))));
app.patch('/api/products/:id', asyncRoute(async (req, res) => res.json(await store.updateProduct(req.params.id, req.body))));
app.delete('/api/products/:id', asyncRoute(async (req, res) => res.json(await store.deleteProduct(req.params.id))));
app.post('/api/orders/reserve', asyncRoute(async (req, res) => res.status(201).json(await store.reserve(req.body.items, req.body.paymentKey))));
app.post('/api/orders/:id/pay', asyncRoute(async (req, res) => res.json(await store.pay(req.params.id, req.body.outcome))));
app.post('/api/orders/:id/cancel', asyncRoute(async (req, res) => res.json(await store.cancel(req.params.id))));
const port = process.env.PORT || 4001;
store.init().then(() => app.listen(port, () => console.log(`Task 01 API listening on ${port}`)));
export { app, store };
