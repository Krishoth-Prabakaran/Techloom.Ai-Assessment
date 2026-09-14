'use client';

import { useEffect, useState } from 'react';
import { Check, LogOut, Moon, Package, Sun, X } from 'lucide-react';
import '../globals.css';
import { Login, clearSession, loadSession } from '../auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';

export default function OrdersPage() {
  const [session, setSession] = useState(null); const [authChecked, setAuthChecked] = useState(false);
  const [orders, setOrders] = useState([]); const [message, setMessage] = useState(''); const [dark, setDark] = useState(false);
  const [pickupId, setPickupId] = useState(''); const [pickupMessage, setPickupMessage] = useState('');
  const load = () => { if (!session) return; fetch(`${API}/orders?userId=${session.id}`).then((response) => response.json()).then(setOrders).catch((error) => setMessage(error.message)); };
  useEffect(() => { setSession(loadSession()); setAuthChecked(true); setDark(localStorage.getItem('common-ground-theme') === 'dark'); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('common-ground-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (!session) { setOrders([]); return; } load(); }, [session?.id]);
  const logout = () => { clearSession(); setSession(null); setOrders([]); };
  const cancel = async (id) => { try { const response = await fetch(`${API}/orders/${id}/cancel`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Cancellation failed'); setOrders((items) => items.map((order) => order.id === id ? { ...order, status: data.status, refund: data.refund || 'simulated-refund-issued' } : order)); setMessage('Order cancelled. Simulated refund issued.'); } catch (error) { setMessage(error.message); } };
  const markReady = async (id) => { try { const response = await fetch(`${API}/orders/${id}/ready`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Failed to mark ready'); setOrders((items) => items.map((order) => order.id === id ? { ...order, status: 'ready' } : order)); } catch (error) { setMessage(error.message); } };
  const pickup = async () => { const id = pickupId.trim(); if (!id) { setPickupMessage('Enter an order ID first.'); return; } try { const response = await fetch(`${API}/orders/${id}/pickup`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Pickup failed'); setPickupMessage('Order picked up. Thanks for stopping by!'); setPickupId(''); load(); } catch (error) { setPickupMessage(error.message === 'NOT_FOUND' ? 'No order found with that ID.' : error.message === 'INVALID_TRANSITION' ? 'That order is not ready for pickup yet.' : error.message); } };
  if (!authChecked) return null;
  if (!session) return <Login onLogin={setSession} />;
  const isAdmin = session.role === 'admin';
  return <><nav><a className="brand" href="/shop">COMMON<span>GROUND</span><small>OBJECTS FOR THE EVERYDAY</small></a><a className="nav-link" href="/shop">Shop</a><a className="nav-link active" href="/orders">Orders</a><button className="theme-switch" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light' : 'Dark'}</span></button><button className="theme-switch" onClick={logout} title="Sign out"><LogOut size={17} /><span>{session.username}</span></button></nav><main><section className="orders orders-page"><p className="eyebrow">YOUR RECEIPTS</p><h1>Order history</h1><p className="quiet">Every purchase, clearly accounted for.</p>{!isAdmin && <div className="pickup-panel"><p className="eyebrow">ORDER PICKUP</p><h2>Ready to collect?</h2><p className="quiet">Once staff mark your order ready, bring the order id here to pick it up.</p><div className="pickup-form"><input value={pickupId} onChange={(event) => setPickupId(event.target.value)} placeholder="Order ID (e.g. 6c6af579)" /><button className="solid" onClick={pickup}><Package size={16} /> Pick up order</button></div>{pickupMessage && <p className="toast">{pickupMessage}</p>}</div>}{orders.length ? <div className="order-list">{orders.map((order) => <div className="order" key={order.id}><div><strong>#{order.id.slice(0, 8)}</strong><span>{(order.items || []).map((item) => `${item.name || item.id} x ${item.quantity}`).join(', ')}</span></div><span className={`status ${order.status}`}>{order.status}</span><strong>${Number(order.total).toFixed(2)}</strong><div className="order-actions">{isAdmin && order.status === 'paid' && <button className="ready-button" onClick={() => markReady(order.id)}>Mark ready</button>}{['reserved', 'paid'].includes(order.status) && <button className="cancel-order" onClick={() => cancel(order.id)}>Cancel & refund</button>}</div></div>)}</div> : <p className="quiet">Your completed orders will appear here.</p>}{message && <p className="toast"><Check size={15} /> {message}</p>}</section></main></>;
}
