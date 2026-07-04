import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { clearSession, getActiveSession } from '../auth/session';
import { useSelectedProperty, usePropertySelection } from '../app/PropertyContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/recommendations', label: 'Recommendations', end: false },
  { to: '/competitors', label: 'Competitors', end: false },
  { to: '/events', label: 'Events', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

function PropertySelector() {
  const { setSelectedPropertyId } = usePropertySelection();
  const { properties, property } = useSelectedProperty();
  const list = properties.data ?? [];
  const empty = list.length === 0;

  return (
    <select
      className="property-selector"
      aria-label="Property"
      value={property?.id ?? ''}
      disabled={empty}
      onChange={(event) => setSelectedPropertyId(event.target.value)}
    >
      {empty ? (
        <option value="" disabled>
          No properties yet
        </option>
      ) : (
        list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))
      )}
    </select>
  );
}

export function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = getActiveSession()?.user ?? null;

  function handleLogout() {
    clearSession();
    // Drop everything cached for this user before the next sign-in.
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◆
          </span>
          PricePilot
        </div>
        <nav aria-label="Main navigation">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    isActive ? 'nav-link nav-link-active' : 'nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="topbar-title">Your pricing copilot</span>
          <div className="topbar-controls">
            <PropertySelector />
            {user && (
              <>
                <span className="topbar-user">{user.displayName}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
