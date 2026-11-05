import { StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from './lib/api'
import { initTheme } from './lib/theme'
import { prefetchDashboard } from './lib/prefetch'
import { Shell } from './components/Shell'
import { Toaster } from './components/toast'
import { persistCache, restoreCache } from './components/resilience'
import { NotFound, RouteError } from './pages/NotFound'
import './styles/base.css'
import './styles/shell.css'
import './styles/components.css'

initTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Network and 5xx errors retry with exponential backoff (1 s, 2 s, 4 s); data on screen is kept meanwhile.
      // Don't retry what won't change (auth, permission, not found, validation).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) && count < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 15_000),
    },
  },
})

// A reload during a server restart still paints the last data (sessionStorage, this tab only).
restoreCache(queryClient)
persistCache(queryClient)

const Dashboard = lazy(() => import('./pages/dashboard/Dashboard'))
// Landing on Home: fetch its data in parallel with its code.
if (/^\/app\/?$/.test(window.location.pathname)) prefetchDashboard(queryClient)
const Tasks = lazy(() => import('./pages/tasks/TasksPage'))
const Calendar = lazy(() => import('./pages/calendar/CalendarPage'))
const Photos = lazy(() => import('./pages/photos/PhotosPage'))
const Places = lazy(() => import('./pages/places/PlacesPage'))
const Notifications = lazy(() => import('./pages/notifications/NotificationsPage'))
const Settings = lazy(() => import('./pages/settings/SettingsPage'))
const Habits = lazy(() => import('./pages/habits/HabitsPage'))
const Contacts = lazy(() => import('./pages/contacts/ContactsPage'))

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'tasks', element: <Tasks /> },
        { path: 'calendar', element: <Calendar /> },
        { path: 'photos/*', element: <Photos /> },
        { path: 'places', element: <Places /> },
        { path: 'notifications', element: <Notifications /> },
        { path: 'settings', element: <Settings /> },
        { path: 'habits/*', element: <Habits /> },
        { path: 'contacts', element: <Contacts /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: '/app' },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
