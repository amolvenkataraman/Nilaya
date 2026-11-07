import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider, useLocation, type RouteObject } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from './lib/api'
import { initTheme } from './lib/theme'
import { prefetchCalendar, prefetchDashboard, prefetchPhotos, prefetchShell, prefetchTasks } from './lib/prefetch'
import { Shell } from './components/Shell'
import { Toaster } from './components/toast'
import { persistCache, restoreCache } from './components/resilience'
import { checkOwnerAtBoot, claimOwner } from './lib/owner'
import { signedIn } from './lib/session'
import type { Me } from './lib/types'
import { NotFound, RouteError } from './pages/NotFound'
import './styles/base.css'
import './styles/shell.css'
import './styles/components.css'

initTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 2 min: coming back to the tab refetches only what is older than that (was 30 s: ~6 requests on Home
      // per refocus). Things that must be fresher set their own staleTime (unread count, today's agenda).
      staleTime: 2 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Network and 5xx errors retry with exponential backoff (1 s, 2 s, 4 s); data on screen is kept meanwhile.
      // Don't retry what won't change (auth, permission, not found, validation).
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) && count < 3,
      retryDelay: (n) => Math.min(1000 * 2 ** n, 15_000),
    },
  },
})

// Data persisted under another login (shared browser) is wiped before anything renders from it.
checkOwnerAtBoot()
// A reload during a server restart still paints the last data (sessionStorage, this tab only).
restoreCache(queryClient)
persistCache(queryClient)
// Once /me answers: if the persisted data was someone else's, drop it and what was loaded from it.
queryClient.getQueryCache().subscribe((e) => {
  if (e.type !== 'updated' || e.action.type !== 'success' || e.query.queryKey[0] !== 'me' || e.query.queryKey.length !== 1) return
  const id = (e.query.state.data as Me | undefined)?.id
  if (id && claimOwner(id)) queryClient.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
})

// Pages are route-level `lazy` (not React.lazy under Suspense): React 19 holds a Suspense fallback for
// ~300 ms before revealing, while the router renders as soon as the chunk arrives.
const page = (load: () => Promise<{ default: ComponentType }>) => async () => ({ Component: (await load()).default })
const Dashboard = page(() => import('./pages/dashboard/Dashboard'))
// Signed out, only the public pages exist (and nothing may call the signed-in API: a 401 means "go sign in").
const authed = signedIn()
if (authed) {
  // Landing on Home: fetch its data in parallel with its code.
  if (window.location.pathname === '/') prefetchDashboard(queryClient)
  prefetchShell(queryClient)
}
// A loader starts the page's main requests while its chunk downloads (it returns at once; hooks pick them up).
const warm = (fn: (qc: QueryClient) => void) => () => (fn(queryClient), null)
const never = () => false // only on entering the page; the queries keep themselves fresh
const Tasks = page(() => import('./pages/tasks/TasksPage'))
const Calendar = page(() => import('./pages/calendar/CalendarPage'))
const Photos = page(() => import('./pages/photos/PhotosPage'))
const Places = page(() => import('./pages/places/PlacesPage'))
const Notifications = page(() => import('./pages/notifications/NotificationsPage'))
const Settings = page(() => import('./pages/settings/SettingsPage'))
const UserProfile = page(() => import('./pages/users/UserPage'))
const Habits = page(() => import('./pages/habits/HabitsPage'))
const Contacts = page(() => import('./pages/contacts/ContactsPage'))

// Standalone pages anyone may open (Comptech/spa.py lets signed-out visitors load exactly these).
const PUBLIC: RouteObject[] = [
  { path: 'login', lazy: page(() => import('./pages/public/Login')) },
  { path: 'register', lazy: page(() => import('./pages/public/Register')) },
  { path: 'photos/upload', lazy: page(() => import('./pages/public/Upload')) },
  { path: 'calendar/public/:id', lazy: page(() => import('./pages/public/PublicCalendar')) },
  { path: 'calendar/countdown/:id/:which?', lazy: page(() => import('./pages/public/Countdown')) },
  { path: 'shared/albums/:id', lazy: page(() => import('./pages/public/SharedAlbum')) },
]

function ToLogin() {
  const loc = useLocation()
  return <Navigate to={'/login?next=' + encodeURIComponent(loc.pathname + loc.search)} replace />
}

const app: RouteObject = {
  element: <Shell />,
  errorElement: <RouteError />,
  hydrateFallbackElement: <div className="app-loading" aria-busy="true" />,
  children: [
    { index: true, lazy: Dashboard },
    { path: 'tasks', lazy: Tasks, loader: warm(prefetchTasks), shouldRevalidate: never },
    { path: 'calendar/*', lazy: Calendar, loader: warm(prefetchCalendar), shouldRevalidate: never },
    { path: 'photos/*', lazy: Photos, loader: warm(prefetchPhotos), shouldRevalidate: never },
    { path: 'places', lazy: Places },
    { path: 'notifications', lazy: Notifications },
    { path: 'settings/*', lazy: Settings },
    { path: 'users/:username', lazy: UserProfile },
    { path: 'habits/*', lazy: Habits },
    { path: 'contacts', lazy: Contacts },
    { path: '*', element: <NotFound /> },
  ],
}
const signedOut: RouteObject[] = [
  // Someone's busy times: public, shown without the app's chrome when signed out.
  { path: 'calendar/availability/:username', lazy: page(() => import('./pages/calendar/PublicAvailability')) },
  { path: '*', element: <ToLogin /> },
]

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="app-loading" aria-busy="true" />,
    children: [...PUBLIC, ...(authed ? [app] : signedOut)],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
