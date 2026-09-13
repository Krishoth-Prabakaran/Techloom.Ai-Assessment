'use client';

import { useEffect, useState } from 'react';
import { Check, Moon, Sun, X } from 'lucide-react';
import '../globals.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]); const [message, setMessage] = useState(''); const [dark, setDark] = useState(false);
  const load = () => fetch(`${API}/orders`).then((response) => response.json()).then(setOrders).catch((error) => setMessage(error.message));
  useEffect(() => { setDark(localStorage.getItem('common-ground-theme') === 'dark'); load(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('common-ground-theme', dark ? 'dark' : 'light'); }, [dark]);
  const cancel = async (id) => { try { const response = await fetch(`${API}/orders/${id}/cancel`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Cancellation failed'); setOrders((items) => items.map((order) => order.id === id ? { ...order, status: data.status, refund: data.refund || 'simulated-refund-issued' } : order)); setMessage('Order cancelled. Simulated refund issued.'); } catch (error) { setMessage(error.message); } };
  return <><nav><a className="brand" href="/shop">COMMON<span>GROUND</span><small>OBJECTS FOR THE EVERYDAY</small></a><a href="/shop">Shop</a><a className="active" href="/orders">Orders</a><button className="theme-switch" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light' : 'Dark'}</span></button></nav><main><section className="orders orders-page"><p className="eyebrow">YOUR RECEIPTS</p><h1>Order history</h1><p className="quiet">Every purchase, clearly accounted for.</p>{orders.length ? <div className="order-list">{orders.map((order) => <div className="order" key={order.id}><div><strong>#{order.id.slice(0, 8)}</strong><span>{(order.items || []).map((item) => `${item.name || item.id} x ${item.quantity}`).join(', ')}</span></div><span className={`status ${order.status}`}>{order.status}</span><strong>${Number(order.total).toFixed(2)}</strong>{['reserved', 'paid'].includes(order.status) && <button className="cancel-order" onClick={() => cancel(order.id)}>Cancel & refund</button>}</div>)}</div> : <p className="quiet">Your completed orders will appear here.</p>}{message && <p className="toast"><Check size={15} /> {message}</p>}</section></main></>;
}
