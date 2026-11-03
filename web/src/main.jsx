import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

function App() {
  const [session, setSession] = useState(null);
  const [meta, setMeta] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const serial = useRef(0);

  function report(error) {
    setError(error.message);
    if (error.status === 401) setSession({ authenticated: false });
  }
  async function refresh() {
    const sequence = ++serial.current;
    try {
      const data = await api('/tasks');
      if (sequence === serial.current) { setTasks(data); setLoading(false); }
    } catch (error) { if (sequence === serial.current) { report(error); setLoading(false); } }
  }
  async function initialize() {
    setError('');
    try {
      const [identity, info] = await Promise.all([api('/session'), api('/version')]);
      setMeta(info); setSession(identity);
    } catch (error) { report(error); }
  }
  useEffect(() => { initialize(); }, []);
  useEffect(() => {
    if (!session?.authenticated) { setTasks([]); return; }
    setLoading(true);
    const stream = new EventSource('/api/events');
    stream.addEventListener('connected', () => { setConnection('live'); refresh(); });
    stream.addEventListener('tasks', refresh);
    stream.onerror = () => { setConnection('reconnecting'); };
    // Refetch on reconnect and focus: events are notifications, the DB is truth.
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    const sessionCheck = setInterval(async () => {
      try { const current = await api('/session'); if (!current.authenticated) setSession(current); }
      catch { setConnection('reconnecting'); }
    }, 30_000);
    return () => { stream.close(); ++serial.current; clearInterval(sessionCheck); window.removeEventListener('focus', focus); };
  }, [session?.authenticated]);

  async function mutate(key, path, method, body) {
    setBusy(key); setError('');
    try {
      await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (key === 'create') setTitle('');
      setDeleting(null);
      await refresh();
    } catch (error) { report(error); }
    finally { setBusy(null); }
  }
  async function login(event) {
    event.preventDefault(); setBusy('login'); setError('');
    try { setSession(await api('/login', { method: 'POST', body: JSON.stringify({ password }) })); setPassword(''); }
    catch (error) { report(error); }
    finally { setBusy(null); }
  }
  async function logout() {
    try { await api('/logout', { method: 'POST' }); setSession({ authenticated: false }); setError(''); }
    catch (error) { report(error); }
  }
  const completed = tasks.filter(t => t.completed).length;
  const visible = tasks.filter(t => (filter === 'all' || (filter === 'done' ? t.completed : !t.completed)) && t.title.toLowerCase().includes(query.toLowerCase()));
  return <div className="shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Taskroom home"><span className="brand-mark">t.</span>taskroom<span className="brand-dot">●</span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <div className="nav-active"><span>▦</span> Team board <span className="count">{tasks.length}</span></div>
      <div className="sidebar-note"><span className="note-icon">↗</span><h3>A little less busy.<br />A little more done.</h3><p>One shared space for the things that move your team forward.</p></div>
      <div className="environment"><span className={`env-dot ${meta?.environment || ''}`}></span><span>{meta?.environment || 'Connecting'} environment</span></div>
      <div className="release">v{meta?.version || '…'} · {meta?.revision?.slice(0, 7) || '…'}</div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace <span className="slash">/</span> <strong>Team board</strong></span><div className="top-actions">{session?.authenticated && <span className={`live ${connection}`}><i />{connection === 'live' ? 'Live updates' : 'Reconnecting…'}</span>}{session?.authenticated && !session.authDisabled && <button className="text-button" onClick={logout}>Sign out</button>}</div></header>
      <div className="content">
        <div className="eyebrow">MAKE ROOM FOR PROGRESS</div>
        <div className="heading"><div><h1>Your team's next steps.</h1><p>Small tasks. Shared momentum. Everything in sync.</p></div><span className="board-symbol">✳</span></div>
        {error && <div className="error" role="alert">{error}{session === null && <button onClick={initialize}>Retry connection</button>}</div>}
        {session === null ? <div className="empty">Connecting to your workspace…</div> : !session.authenticated ? <form className="login card" onSubmit={login}><span className="eyebrow">WELCOME BACK</span><h2>Enter your workspace</h2><p>Use the board password for this environment.</p><label htmlFor="password">Workspace password</label><input id="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /><button className="primary" disabled={busy === 'login'}>{busy === 'login' ? 'Signing in…' : 'Open workspace →'}</button></form> : <>
          <section className="stats" aria-label="Task summary"><div className="stat"><span>Total tasks</span><strong>{tasks.length}<small>in your workspace</small></strong></div><div className="stat"><span>To do</span><strong>{tasks.length - completed}<small>next opportunities</small></strong></div><div className="stat completed"><span>Completed</span><strong>{completed}<small>steps forward</small></strong></div></section>
          <section className="board card">
            <form className="create" onSubmit={e => { e.preventDefault(); mutate('create', '/tasks', 'POST', { title }); }}><label className="sr-only" htmlFor="new-task">New task</label><span className="plus">+</span><input id="new-task" placeholder="What needs to get done?" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} required /><button className="primary" disabled={!!busy || !title.trim()}>{busy === 'create' ? 'Adding…' : 'Add task'}<span>↗</span></button></form>
            <div className="toolbar"><div className="filters" aria-label="Filter tasks">{[['all', 'All tasks'], ['todo', 'To do'], ['done', 'Completed']].map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="search"><span>⌕</span><input aria-label="Search tasks" placeholder="Find a task…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
            <div className="table-label"><span>TASK</span><span>CREATED</span><span /></div>
            {loading ? <div className="empty">Loading your tasks…</div> : !visible.length ? <div className="empty"><span className="empty-icon">✓</span><h3>{tasks.length ? 'Nothing in this view' : 'A fresh start for your team'}</h3><p>{tasks.length ? 'Try another filter or search.' : 'Add your first task above. Everyone on this board will see it.'}</p></div> : <ul className="tasks">{visible.map(task => <li key={task.id} className={`task ${task.completed ? 'done' : ''}`} data-testid="task-row"><label className="task-title"><input type="checkbox" checked={task.completed} disabled={!!busy} onChange={e => mutate(task.id, `/tasks/${task.id}`, 'PATCH', { completed: e.target.checked })} /><span>{task.title}</span></label><time dateTime={task.createdAt}>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(task.createdAt))}</time><div className="delete-area">{deleting === task.id ? <><button className="danger" disabled={!!busy} onClick={() => mutate(task.id, `/tasks/${task.id}`, 'DELETE')}>Delete</button><button className="text-button" onClick={() => setDeleting(null)}>Cancel</button></> : <button className="delete" aria-label={`Delete ${task.title}`} onClick={() => setDeleting(task.id)}>×</button>}</div></li>)}</ul>}
            <footer className="board-footer"><span>{visible.length} {visible.length === 1 ? 'task' : 'tasks'} shown</span><span>Changes sync across open browsers</span></footer>
          </section>
          <p className="bottom-note">A shared board. A clearer day.</p>
        </>}
      </div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
