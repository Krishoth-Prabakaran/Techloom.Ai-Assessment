'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Edit3, LogOut, Moon, Plus, Search, ShoppingBag, Sun, Trash2, X } from 'lucide-react';
import './globals.css';
import { Login, clearSession, loadSession } from './auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';
const emptyProduct = { id: '', name: '', category: 'Objects', price: '', stock: '', description: '', accent: '#68765a', imageUrl: '' };

function ProductForm({ product, onSave, onClose }) {
  const [form, setForm] = useState(product || emptyProduct);
  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return <form className="product-form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, price: Number(form.price), stock: Number(form.stock) }); }}>
    <div className="drawer-head"><div><p className="eyebrow">CATALOG / {product ? 'EDIT' : 'NEW'}</p><h2>{product ? 'Refine object' : 'Add an object'}</h2></div><button type="button" className="close" onClick={onClose}><X /></button></div>
    <label>Product ID<input required disabled={Boolean(product)} value={form.id} onChange={update('id')} placeholder="field-jacket" /></label>
    <label>Name<input required value={form.name} onChange={update('name')} placeholder="Object name" /></label>
    <div className="form-row"><label>Category<input required value={form.category} onChange={update('category')} placeholder="Objects" /></label><label>Price<input required type="number" min="0" step="0.01" value={form.price} onChange={update('price')} placeholder="0.00" /></label></div>
    <div className="form-row"><label>Stock<input required type="number" min="0" value={form.stock} onChange={update('stock')} placeholder="0" /></label><label>Accent<input value={form.accent} onChange={update('accent')} placeholder="#68765a" /></label></div>
    <label>Description<textarea required value={form.description} onChange={update('description')} placeholder="A short description..." /></label>
    <label>Image URL <span className="optional">optional</span><input value={form.imageUrl || ''} onChange={update('imageUrl')} placeholder="https://..." /></label>
    <button className="solid" type="submit"><Check size={16} /> {product ? 'Save changes' : 'Create object'}</button>
  </form>;
}

function CatalogDrawer({ products, saveProduct, removeProduct, close }) {
  const [editing, setEditing] = useState(null);
  return <dialog open className="drawer"><div className="drawer-panel">
    {editing ? <ProductForm product={editing.id ? editing : null} onSave={(product) => { saveProduct(product, editing.id); setEditing(null); }} onClose={() => setEditing(null)} /> : <>
      <div className="drawer-head"><div><p className="eyebrow">CURATION DESK</p><h2>Manage collection</h2></div><button className="close" onClick={close}><X /></button></div>
      <button className="new-object" onClick={() => setEditing({})}><Plus size={16} /> Add object</button>
      <div className="manage-list">{products.map((product) => <div className="manage-row" key={product.id}><div><strong>{product.name}</strong><span>{product.category} - {product.stock} available</span></div><strong>${Number(product.price).toFixed(2)}</strong><button onClick={() => setEditing(product)} aria-label={`Edit ${product.name}`}><Edit3 size={15} /></button><button className="delete" onClick={() => removeProduct(product.id)} aria-label={`Delete ${product.name}`}><Trash2 size={15} /></button></div>)}</div>
    </>}
  </div></dialog>;
}

function ProductDetails({ product, add, close, canOrder }) {
  return <dialog open className="product-details"><div className="product-details-panel"><button className="close" onClick={close}><X /></button><div className="product-details-visual" style={{ background: product.imageUrl ? `url(${product.imageUrl}) center/cover` : product.accent }}><span>{product.category}</span></div><p className="eyebrow">OBJECT PROFILE</p><h2>{product.name}</h2><p className="product-details-description">{product.description}</p><div className="product-details-meta"><strong>${Number(product.price).toFixed(2)}</strong><span>{product.stock} available</span></div>{canOrder && <button className="solid" onClick={() => { add(product); close(); }} disabled={!product.stock}><ShoppingBag size={16} /> Add to bag</button>}</div></dialog>;
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [selected, setSelected] = useState(null);
  const [dark, setDark] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const request = async (path, options) => { const response = await fetch(`${API}${path}`, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`); return data; };
  const load = async (nextQuery = query, nextCategory = category) => { try { setProducts(await request(`/products?q=${encodeURIComponent(nextQuery)}&category=${encodeURIComponent(nextCategory === 'All' ? '' : nextCategory)}`)); } catch (error) { setMessage(`Store connection unavailable: ${error.message}`); } };
  useEffect(() => { setSession(loadSession()); setAuthChecked(true); setDark(localStorage.getItem('common-ground-theme') === 'dark'); request('/products').then(setProducts).catch((error) => setMessage(`Store connection unavailable: ${error.message}`)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('common-ground-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { if (!session) { setOrders([]); return; } request(`/orders?userId=${session.id}`).then(setOrders).catch(() => {}); }, [session?.id]);
  useEffect(() => { if (!session) { setCart([]); return; } request(`/cart?userId=${session.id}`).then((items) => setCart(items || [])).catch(() => {}); }, [session?.id]);
  useEffect(() => { if (!session) return; request('/cart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: session.id, items: cart }) }).catch(() => {}); }, [cart, session?.id]);
  const logout = () => { clearSession(); setSession(null); setCart([]); setOrders([]); };
  const add = (product) => setCart((items) => [...items.filter((item) => item.id !== product.id), { ...product, quantity: (items.find((item) => item.id === product.id)?.quantity || 0) + 1 }]);
  const checkout = async (outcome = 'success') => { try { const order = await request('/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })), sessionKey: crypto.randomUUID(), userId: session.id }) }); const finalOrder = await request(`/orders/${order.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }) }); setOrders((items) => [finalOrder, ...items]); setCart([]); setCartOpen(false); setMessage(`Order ${finalOrder.status}.`); await load(); } catch (error) { setMessage(`Checkout failed: ${error.message}`); } };
  const saveProduct = async (product, id) => { try { const data = await request(id ? `/products/${id}` : '/products', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(product) }); setProducts((items) => id ? items.map((item) => item.id === id ? data : item) : [...items, data]); setMessage(id ? 'Object updated.' : 'Object added to the collection.'); } catch (error) { setMessage(error.message); } };
  const removeProduct = async (id) => { if (!window.confirm('Delete this object?')) return; try { await request(`/products/${id}`, { method: 'DELETE' }); setProducts((items) => items.filter((item) => item.id !== id)); setMessage('Object removed.'); } catch (error) { setMessage(error.message); } };
  const categories = ['All', ...new Set(products.map((product) => product.category))];
  const shown = products.filter((product) => (category === 'All' || product.category === category) && (!query || `${product.name} ${product.description}`.toLowerCase().includes(query.toLowerCase())));
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (!authChecked) return null;
  if (!session) return <Login onLogin={setSession} />;
  const isAdmin = session.role === 'admin';

  return <><nav><a className="brand" href="/shop">COMMON<span>GROUND</span><small>OBJECTS FOR THE EVERYDAY</small></a><a className="nav-link active" href="/shop">Shop</a><a className="nav-link" href="/orders">Orders</a>{isAdmin && <button className="manage-trigger" onClick={() => setDrawer(true)}><Plus size={15} /> Curate</button>}<button className="theme-switch" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}<span>{dark ? 'Light' : 'Dark'}</span></button><button className="theme-switch" onClick={logout} title="Sign out"><LogOut size={17} /><span>{session.username}</span></button>{!isAdmin && <button className="bag" onClick={() => setCartOpen(true)}><ShoppingBag size={17} /><span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></button>}</nav>
    <main><section className="hero"><div><p className="eyebrow">SMALL BATCH / EVERYDAY OBJECTS</p><h1>Useful things,<br /><em>well considered.</em></h1><p>Tools, textures, and quiet color for the spaces and rituals you return to.</p><a className="hero-link" href="#shop">Explore the edit <ArrowRight size={16} /></a></div><div className="hero-art"><div className="sun"></div><div className="arch"></div><span>OBJECTS / 01</span></div></section>
      <section id="shop" className="shop"><div className="toolbar"><div><p className="eyebrow">THE EDIT / {shown.length} OBJECTS</p><h2>Current collection</h2></div><label className="search"><Search size={16} /><input placeholder="Search objects" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); load(value, category); }} /></label></div><div className="filters">{categories.map((item) => <button className={category === item ? 'active' : ''} onClick={() => { setCategory(item); load(query, item); }} key={item}>{item}</button>)}</div><div className="grid">{shown.map((product, index) => <article className="card" style={{ '--delay': `${index * 60}ms` }} key={product.id}><div className="visual" style={{ background: product.imageUrl ? `url(${product.imageUrl}) center/cover` : product.accent }}><span>{product.category}</span>{!isAdmin && <button onClick={() => add(product)} aria-label={`Add ${product.name}`}><ShoppingBag size={17} /></button>}</div><div className="card-copy"><button className="details-link" onClick={() => setSelected(product)}>View details</button><h3>{product.name}</h3><p>{product.description}</p><strong>${Number(product.price).toFixed(2)}</strong></div></article>)}</div>{message && <p className="toast">{message}</p>}</section></main>
    {!isAdmin && cartOpen && <dialog open className="cart-dialog"><div className="drawer-panel"><div className="drawer-head"><div><p className="eyebrow">YOUR BAG / {cart.length}</p><h2>Ready when you are.</h2></div><button className="close" onClick={() => setCartOpen(false)}><X /></button></div>{cart.length ? <>{cart.map((item) => <div className="cart-line" key={item.id}><span>{item.name} x {item.quantity}</span><strong>${(item.price * item.quantity).toFixed(2)}</strong></div>)}<div className="cart-total"><span>Total</span><strong>${total.toFixed(2)}</strong></div><button className="solid" onClick={() => checkout('success')}>Complete purchase <ArrowRight size={16} /></button><button className="solid failure-button" onClick={() => checkout('failure')}>Simulate failed payment</button><button className="timeout" onClick={() => checkout('timeout')}>Simulate timeout</button></> : <p className="quiet">Your bag is waiting for its first object.</p>}</div></dialog>}
    {drawer && isAdmin && <CatalogDrawer products={products} saveProduct={saveProduct} removeProduct={removeProduct} close={() => setDrawer(false)} />}{selected && <ProductDetails product={selected} add={add} close={() => setSelected(null)} canOrder={!isAdmin} />}
  </>;
}
