import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// Shared HTTP helper: JSON requests go through /api (proxied by Vite in development).
// The browser sends same-origin session cookies automatically, including HttpOnly ones.
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(data.error || 'Something went wrong. Please try again.'),
      { status: response.status }
    );
  }
  // DELETE returns 204 with no body, so there is no JSON to parse.
  return response.status === 204 ? null : response.json();
}

function App() {
  // null means the initial session check is pending; authenticated selects login or board.
  const [session, setSession] = useState(null);
  const [meta, setMeta] = useState(null);
  const [tasks, setTasks] = useState([]);
  // Controlled inputs: React state holds the current task and account form values.
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [registering, setRegistering] = useState(false);
  // Filters change the visible list locally without modifying stored tasks.
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // busy identifies the pending action; deleting identifies the row awaiting confirmation.
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // A ref survives renders without causing them. This counter identifies the newest refresh.
  const serial = useRef(0);

  // An expired or missing session sends the user back to the account form.
  function report(error) {
    setError(error.message);
    if (error.status === 401) setSession({ authenticated: false });
  }
  async function refresh() {
    // Requests can finish out of order. Only the latest request may update the board.
    const sequence = ++serial.current;
    try {
      const data = await api('/tasks');
      if (sequence === serial.current) {
        setTasks(data);
        setLoading(false);
      }
    } catch (error) {
      if (sequence === serial.current) {
        report(error);
        setLoading(false);
      }
    }
  }
  // Fetch identity and deployment metadata together; neither request depends on the other.
  async function initialize() {
    setError('');
    try {
      const [identity, info] = await Promise.all([
        api('/session'),
        api('/version')
      ]);
      setMeta(info);
      setSession(identity);
    } catch (error) {
      report(error);
    }
  }
  // An empty dependency array runs initialization when this component mounts.
  useEffect(() => {
    initialize();
  }, []);
  // Recreate the subscription whenever login status or account identity changes.
  useEffect(() => {
    if (!session?.authenticated) {
      setTasks([]);
      return;
    }
    // Start each account with a fresh board view and fetch its own tasks.
    setTasks([]);
    setTitle('');
    setQuery('');
    setFilter('all');
    setDeleting(null);
    setLoading(true);
    // Load tasks even if the proxy delays or blocks the live-update stream.
    refresh();
    // Server-Sent Events (SSE) keep one HTTP connection open for server notifications.
    // EventSource reconnects automatically; each notification triggers a fresh API read.
    const stream = new EventSource('/api/events');
    stream.addEventListener('connected', () => {
      setConnection('live');
      refresh();
    });
    stream.addEventListener('tasks', refresh);
    stream.onerror = () => {
      setConnection('reconnecting');
    };
    // Refetch on reconnect and focus: events are notifications, the DB is truth.
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    // Detect session expiration or an account switch made in another browser tab.
    const sessionCheck = setInterval(async () => {
      try {
        const current = await api('/session');
        if (!current.authenticated || current.user?.id !== session.user?.id)
          setSession(current);
      } catch {
        setConnection('reconnecting');
      }
    }, 30_000);
    // React calls cleanup before rerunning this effect and when the component unmounts.
    // Invalidate outstanding refreshes so an old response cannot repopulate the board.
    return () => {
      stream.close();
      ++serial.current;
      clearInterval(sessionCheck);
      window.removeEventListener('focus', focus);
    };
  }, [session?.authenticated, session?.user?.id]);

  // All task writes share pending/error handling and reload the saved state afterward.
  async function mutate(key, path, method, body) {
    setBusy(key);
    setError('');
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (key === 'create') setTitle('');
      setDeleting(null);
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  }
  // One form handles login and registration; preventDefault avoids a full page reload.
  // Number inputs still supply strings, so convert age before sending it to the API.
  async function login(event) {
    event.preventDefault();
    setBusy('login');
    setError('');
    try {
      setSession(
        await api(registering ? '/register' : '/login', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            ...(registering
              ? { name, age: age === '' ? null : Number(age) }
              : {})
          })
        })
      );
      setPassword('');
    } catch (error) {
      report(error);
    } finally {
      setBusy(null);
    }
  }
  // The server clears the HttpOnly cookie; updating session triggers effect cleanup.
  async function logout() {
    try {
      await api('/logout', { method: 'POST' });
      setSession({ authenticated: false });
      setError('');
    } catch (error) {
      report(error);
    }
  }
  // Derive counts and visible rows from tasks instead of storing duplicate state.
  const completed = tasks.filter((t) => t.completed).length;
  const visible = tasks.filter(
    (t) =>
      (filter === 'all' || (filter === 'done' ? t.completed : !t.completed)) &&
      t.title.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Taskroom home">
          <span className="brand-mark">t.</span>taskroom
          <span className="brand-dot">●</span>
        </a>
        <div className="workspace-label">
          {session?.user?.name || 'YOUR WORKSPACE'}
        </div>
        <div className="nav-active">
          <span>▦</span> My tasks <span className="count">{tasks.length}</span>
        </div>
        <div className="sidebar-note">
          <span className="note-icon">↗</span>
          <h3>
            A little less busy.
            <br />A little more done.
          </h3>
          <p>Your private space for the things you want to get done.</p>
        </div>
        <div className="environment">
          <span className={`env-dot ${meta?.environment || ''}`}></span>
          <span>{meta?.environment || 'Connecting'} environment</span>
        </div>
        <div className="release">
          v{meta?.version || '…'} · {meta?.revision?.slice(0, 7) || '…'}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> <strong>My tasks</strong>
          </span>
          <div className="top-actions">
            {session?.authenticated && (
              <span className={`live ${connection}`}>
                <i />
                {connection === 'live' ? 'Live updates' : 'Reconnecting…'}
              </span>
            )}
            {session?.authenticated && (
              <button className="text-button" onClick={logout}>
                Sign out
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <div className="eyebrow">MAKE ROOM FOR PROGRESS</div>
          <div className="heading">
            <div>
              <h1>Your next steps.</h1>
              <p>Your tasks, your progress. Everything in sync.</p>
            </div>
            <span className="board-symbol">✳</span>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              {session === null && (
                <button onClick={initialize}>Retry connection</button>
              )}
            </div>
          )}
          {/* Render one of three states: connecting, account form, or private task board. */}
          {session === null ? (
            <div className="empty">Connecting to your workspace…</div>
          ) : !session.authenticated ? (
            <form className="login card" onSubmit={login}>
              <span className="eyebrow">
                {registering ? 'GET STARTED' : 'WELCOME BACK'}
              </span>
              <h2>
                {registering
                  ? 'Create your account'
                  : 'Sign in to your account'}
              </h2>
              <p>Your tasks are private to your account.</p>
              {/* Profile fields are only needed when creating an account. */}
              {registering && (
                <>
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <label htmlFor="age">Age (optional)</label>
                  <input
                    id="age"
                    type="number"
                    min="0"
                    max="150"
                    step="1"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                  />
                </>
              )}
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={registering ? 'new-password' : 'current-password'}
                minLength={registering ? 12 : undefined}
                required
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="primary" disabled={busy === 'login'}>
                {busy === 'login'
                  ? 'Please wait…'
                  : registering
                    ? 'Create account'
                    : 'Sign in'}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={!!busy}
                onClick={() => {
                  setRegistering(!registering);
                  setPassword('');
                  setError('');
                }}
              >
                {registering
                  ? 'Already have an account? Sign in'
                  : 'Create an account'}
              </button>
            </form>
          ) : (
            <>
              <section className="stats" aria-label="Task summary">
                <div className="stat">
                  <span>Total tasks</span>
                  <strong>
                    {tasks.length}
                    <small>in your workspace</small>
                  </strong>
                </div>
                <div className="stat">
                  <span>To do</span>
                  <strong>
                    {tasks.length - completed}
                    <small>next opportunities</small>
                  </strong>
                </div>
                <div className="stat completed">
                  <span>Completed</span>
                  <strong>
                    {completed}
                    <small>steps forward</small>
                  </strong>
                </div>
              </section>
              <section className="board card">
                <form
                  className="create"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutate('create', '/tasks', 'POST', { title });
                  }}
                >
                  <label className="sr-only" htmlFor="new-task">
                    New task
                  </label>
                  <span className="plus">+</span>
                  <input
                    id="new-task"
                    placeholder="What needs to get done?"
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                  <button
                    className="primary"
                    aria-busy={busy === 'create'}
                    disabled={!!busy || !title.trim()}
                  >
                    {busy === 'create' ? 'Adding…' : 'Add task'}
                    <span>↗</span>
                  </button>
                </form>
                <div className="toolbar">
                  <div className="filters" aria-label="Filter tasks">
                    {[
                      ['all', 'All tasks'],
                      ['todo', 'To do'],
                      ['done', 'Completed']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={filter === value}
                        className={filter === value ? 'selected' : ''}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <span>⌕</span>
                    <input
                      aria-label="Search tasks"
                      placeholder="Find a task…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="table-label">
                  <span>TASK</span>
                  <span>CREATED</span>
                  <span />
                </div>
                {/* Distinguish loading from an empty board or an empty filtered result. */}
                {loading ? (
                  <div className="empty">Loading your tasks…</div>
                ) : !visible.length ? (
                  <div className="empty">
                    <span className="empty-icon">✓</span>
                    <h3>
                      {tasks.length
                        ? 'Nothing in this view'
                        : 'A fresh start for you'}
                    </h3>
                    <p>
                      {tasks.length
                        ? 'Try another filter or search.'
                        : 'Add your first task above. Only you can see it.'}
                    </p>
                  </div>
                ) : (
                  <ul className="tasks">
                    {visible.map((task) => (
                      <li
                        key={task.id}
                        className={`task ${task.completed ? 'done' : ''}`}
                        data-testid="task-row"
                      >
                        <label className="task-title">
                          <input
                            type="checkbox"
                            checked={task.completed}
                            disabled={!!busy}
                            onChange={(e) =>
                              mutate(task.id, `/tasks/${task.id}`, 'PATCH', {
                                completed: e.target.checked
                              })
                            }
                          />
                          <span>{task.title}</span>
                        </label>
                        <time dateTime={task.createdAt}>
                          {new Intl.DateTimeFormat('en', {
                            month: 'short',
                            day: 'numeric'
                          }).format(new Date(task.createdAt))}
                        </time>
                        {/* The first click asks for confirmation; only Delete sends a request. */}
                        <div className="delete-area">
                          {deleting === task.id ? (
                            <>
                              <button
                                className="danger"
                                disabled={!!busy}
                                onClick={() =>
                                  mutate(task.id, `/tasks/${task.id}`, 'DELETE')
                                }
                              >
                                Delete
                              </button>
                              <button
                                className="text-button"
                                onClick={() => setDeleting(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="delete"
                              aria-label={`Delete ${task.title}`}
                              onClick={() => setDeleting(task.id)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <footer className="board-footer">
                  <span>
                    {visible.length} {visible.length === 1 ? 'task' : 'tasks'}{' '}
                    shown
                  </span>
                  <span>Changes sync across open browsers</span>
                </footer>
              </section>
              <p className="bottom-note">Your own board. A clearer day.</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
// Attach the React application to the root element provided by web/index.html.
createRoot(document.getElementById('root')).render(<App />);
