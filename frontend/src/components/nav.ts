// The apps: launcher grid, command palette and the G-then-letter hotkeys.
export interface AppDef { id: string; to: string; label: string; icon: string; key?: string; hue: string; external?: boolean; soon?: boolean; group?: string; staff?: boolean }

/** Order used everywhere apps are listed (launcher, palette, shortcuts, Home): planning apps together. */
export const APPS: AppDef[] = [
  { id: 'home', to: '/', label: 'Home', icon: 'home', key: 'h', hue: '#0f6d77', group: '' },
  { id: 'calendar', to: '/calendar', label: 'Calendar', icon: 'calendar', key: 'c', hue: '#0891b2', group: 'Planning' },
  { id: 'tasks', to: '/tasks', label: 'Tasks', icon: 'tasks', key: 't', hue: '#2563eb', group: 'Planning' },
  { id: 'habits', to: '/habits', label: 'Habits', icon: 'repeat', key: 'b', hue: '#ea580c', group: 'Planning' },
  { id: 'contacts', to: '/contacts', label: 'Contacts', icon: 'users', key: 'o', hue: '#7c3aed', group: 'People & places' },
  { id: 'places', to: '/places', label: 'Places', icon: 'map', key: 'm', hue: '#16a34a', group: 'People & places' },
  { id: 'photos', to: '/photos', label: 'Photos', icon: 'photo', key: 'p', hue: '#db2777', group: 'Media' },
  { id: 'notifications', to: '/notifications', label: 'Notifications', icon: 'bell', key: 'n', hue: '#ca8a04', group: 'System' },
  { id: 'settings', to: '/settings', label: 'Settings', icon: 'settings', key: 's', hue: '#64748b', group: 'System' },
]
/** Staff-only entries at the end of System. */
export const STAFF_APPS: AppDef[] = [
  { id: 'usage', to: '/settings/usage', label: 'Usage', icon: 'chart', hue: '#0f766e', group: 'System', staff: true },
  { id: 'admin', to: '/admin/', label: 'Admin', icon: 'wrench', hue: '#475569', group: 'System', staff: true, external: true },
]
export const CLASSIC: AppDef = { id: 'classic', to: '/', label: 'Classic view', icon: 'classic', hue: '#475569', external: true }

/** Back-compat for the palette and hotkeys. */
export const NAV = APPS.filter((a) => a.key).map((a) => ({ to: a.to, label: a.label, icon: a.icon, key: a.key! }))
