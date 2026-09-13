'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import '../globals.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(localStorage.getItem('common-ground-theme') === 'dark'); fetch(`${API}/orders`).then((response) => response.json()).then(setOrders); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('common-ground-theme', dark ? 'dark' : 'light'); }, [dark]);
  return <><nav><a className="brand" href="/shop">COMMON<span>GROUND</span></a><a href="/shop">Shop</a><a className="active" href="/orders">Orders</a><button className="theme-switch" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? <Sun size={17}/> : <Moon size={17}/>}<span>{dark ? 'Light' : 'Dark'}</span></button></nav><main><section className="orders orders-page"><p className="eyebrow">YOUR RECEIPTS</p><h1>Order history</h1><p className="quiet">Every purchase, clearly accounted for.</p>{orders.length ? <div className="order-list">{orders.map((order) => <div className="order" key={order.id}><div><strong>#{order.id.slice(0, 8)}</strong><span>{(order.items || []).map((item) => `${item.name || item.id} × ${item.quantity}`).join(', ')}</span></div><span className={`status ${order.status}`}>{order.status}</span><strong>${order.total}</strong></div>)}</div> : <p className="quiet">Your completed orders will appear here.</p>}</section></main></>;
}
