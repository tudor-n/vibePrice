import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './features/login/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { RecommendationsPage } from './features/recommendations/RecommendationsPage';
import { CompetitorsPage } from './features/competitors/CompetitorsPage';
import { EventsPage } from './features/events/EventsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SetupGuard } from './features/setup/SetupGuard';

export const router = createBrowserRouter([
  // Login lives outside the Layout — no sidebar, no guard.
  { path: '/login', element: <LoginPage /> },
  // The onboarding wizard is full-screen — also outside the Layout.
  // SetupGuard redirects owners who already have a property to the dashboard.
  {
    path: '/setup',
    element: (
      <RequireAuth>
        <SetupGuard />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <App />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'recommendations', element: <RecommendationsPage /> },
      { path: 'competitors', element: <CompetitorsPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
