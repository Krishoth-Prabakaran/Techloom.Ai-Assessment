'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

export const AUTH_KEY = 'common-ground-auth';
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}

export function clearSession() {
  localStorage.removeItem(AUTH_KEY);
}

export function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isLogin && password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const response = await fetch(`${API}/auth/${isLogin ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error === 'USERNAME_TAKEN' ? 'That username is already taken.' : data.error === 'INVALID_CREDENTIALS' ? 'Incorrect username or password.' : data.error || 'Something went wrong.');
      const session = { id: data.id, username: data.username, role: data.role };
      localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const switchMode = () => { setMode(isLogin ? 'register' : 'login'); setError(''); setPassword(''); setConfirmPassword(''); };
  return <div className="login-screen"><form className="login-card" onSubmit={submit}>
    <p className="eyebrow">COMMON GROUND / {isLogin ? 'SIGN IN' : 'CREATE ACCOUNT'}</p>
    <h1>{isLogin ? 'Welcome back.' : 'Join Common Ground.'}</h1>
    <p className="quiet">{isLogin ? 'Sign in to continue to the shop.' : 'New accounts start with shopper access.'}</p>
    <div className="product-form">
      <label>Username<input required autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. jordan" /></label>
      <label>Password<input required type="password" minLength={isLogin ? undefined : 6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="********" /></label>
      {!isLogin && <label>Confirm password<input required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="********" /></label>}
      {error && <p className="login-error">{error}</p>}
      <button className="solid" type="submit" disabled={loading}><Check size={16} /> {loading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}</button>
    </div>
    <p className="login-hint">{isLogin ? <>New here? <button type="button" className="link-button" onClick={switchMode}>Create an account</button></> : <>Already have an account? <button type="button" className="link-button" onClick={switchMode}>Sign in</button></>}</p>
  </form></div>;
}
