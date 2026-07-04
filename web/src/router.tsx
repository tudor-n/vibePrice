import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { RecommendationsPage } from './features/recommendations/RecommendationsPage';
import { CompetitorsPage } from './features/competitors/CompetitorsPage';
import { EventsPage } from './features/events/EventsPage';
import { SettingsPage } from './features/settings/SettingsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'recommendations', element: <RecommendationsPage /> },
      { path: 'competitors', element: <CompetitorsPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
