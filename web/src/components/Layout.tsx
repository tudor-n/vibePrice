import { NavLink, Outlet } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/recommendations', label: 'Recommendations', end: false },
  { to: '/competitors', label: 'Competitors', end: false },
  { to: '/events', label: 'Events', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Layout() {
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
          {/* Property selector placeholder — becomes a real, app-wide
              selector once multi-property navigation lands. */}
          <select
            className="property-selector"
            aria-label="Property selector (coming soon)"
            disabled
          >
            <option>All properties</option>
          </select>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
