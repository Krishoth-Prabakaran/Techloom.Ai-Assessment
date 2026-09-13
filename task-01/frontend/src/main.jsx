import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, CreditCard, Moon, Package, RefreshCw, Sun, X } from 'lucide-react';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4001/api';

function Header({ dark, setDark }) {
  return <header className="app-header"><a className="brand-lockup" href="/">KRISH <span>COUNTER</span><small>RETAIL OPERATIONS</small></a><nav><a className={location.pathname === '/' ? 'active' : ''} href="/">Inventory</a><a className={location.pathname === '/orders' ? 'active' : ''} href="/orders">Orders</a></nav><button className="theme-toggle" onClick={() => setDark(!dark)} title={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={17}/> : <Moon size={17}/>}<span>{dark ? 'Light' : 'Dark'}</span></button></header>;
}

function Inventory({ products, load, cart, add, order, reserve, pay, total, message }) {
  return <section className="layout"><div><div className="section-head"><div><p className="kicker">LIVE INVENTORY</p><h2>Available now</h2></div><button className="icon-button" onClick={load} title="Refresh inventory"><RefreshCw size={18}/></button></div><div className="products">{products.map((product) => <article className="product" key={product.id}>{product.imageUrl ? <img className="product-image" src={product.imageUrl} alt={product.name}/> : <div className="product-icon"><Package size={22}/></div>}<h3>{product.name}</h3><p className="price">${product.price.toFixed(2)}</p><div className="stock"><span>{product.stock} available</span><button onClick={() => add(product)} disabled={!product.stock}>Add to cart</button></div></article>)}</div></div><aside className="checkout"><p className="kicker">CURRENT CART</p><h2>Checkout</h2>{!cart.length && !order ? <p className="muted">Add an item to reserve its stock and begin.</p> : <>{cart.map((item) => <div className="line" key={item.productId}><span>{item.name} × {item.quantity}</span><strong>${(item.price * item.quantity).toFixed(2)}</strong></div>)}<div className="total"><span>Total</span><strong>${(order?.total || total).toFixed(2)}</strong></div>{!order ? <button className="primary" onClick={reserve}><CreditCard size={17}/> Reserve & continue</button> : <div className="payment"><p className="muted">Mock gateway</p><button className="success" onClick={() => pay('success')}><Check size={16}/> Approve payment</button><button className="danger" onClick={() => pay('failure')}><X size={16}/> Fail payment</button><button className="ghost" onClick={() => pay('timeout')}>Simulate timeout</button></div>}</>}{message && <p className="message">{message}</p>}</aside></section>;
}

function Orders({ orders }) {
  return <section className="orders-page"><p className="kicker">TRANSACTION LOG</p><h1>Order history</h1><p className="lede">A clear record of every reservation and payment outcome.</p>{orders.length ? <div className="order-list">{orders.map((order) => <article className="order" key={order.id}><div><strong>#{order.id.slice(0, 8)}</strong><span>{(order.items || []).map((item) => `${item.name || item.id} × ${item.quantity}`).join(', ')}</span></div><span className={`status ${order.status}`}>{order.status}</span><strong>${Number(order.total).toFixed(2)}</strong></article>)}</div> : <p className="muted">No orders have been recorded yet.</p>}</section>;
}

function App() {
  const [products, setProducts] = useState([]); const [orders, setOrders] = useState([]); const [cart, setCart] = useState([]); const [order, setOrder] = useState(null); const [message, setMessage] = useState(''); const [dark, setDark] = useState(() => localStorage.getItem('counter-theme') === 'dark');
  const load = () => fetch(`${API}/products`).then((response) => response.json()).then(setProducts);
  const loadOrders = () => fetch(`${API}/orders`).then((response) => response.json()).then(setOrders);
  useEffect(() => { load(); loadOrders(); }, []); useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('counter-theme', dark ? 'dark' : 'light'); }, [dark]);
  const add = (product) => setCart((items) => { const existing = items.find((item) => item.productId === product.id); return existing ? items.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...items, { productId: product.id, name: product.name, price: product.price, quantity: 1 }]; });
  const reserve = async () => { try { const response = await fetch(`${API}/orders/reserve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart, paymentKey: crypto.randomUUID() }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setOrder(data); setMessage('Stock reserved for five minutes. Choose a mock payment outcome.'); } catch (error) { setMessage(error.message); } };
  const pay = async (outcome) => { const response = await fetch(`${API}/orders/${order.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }) }); const data = await response.json(); setOrder(data); setMessage(`Order is ${data.status}.`); load(); loadOrders(); };
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0); const isOrders = window.location.pathname === '/orders';
  return <main><Header dark={dark} setDark={setDark}/>{isOrders ? <Orders orders={orders}/> : <><section className="hero"><div><p className="eyebrow">OPERATIONS / TODAY</p><h1>Krish <span>Counter</span></h1><p className="lede">A calm, precise workspace for keeping every shelf and sale in balance.</p></div><div className="hero-art"><div className="hero-grid"></div></div></section><Inventory products={products} load={load} cart={cart} add={add} order={order} reserve={reserve} pay={pay} total={total} message={message}/></>}</main>;
}

createRoot(document.getElementById('root')).render(<App />);
