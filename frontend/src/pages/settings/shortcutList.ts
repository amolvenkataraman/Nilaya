// Every keyboard shortcut in the web app, by app, for Settings › Keyboard shortcuts. Keys are written as in the
// Tasks help ("g t", "j / k", "Ctrl K"): spaces separate key caps, a lone "/" or "–" between them is text.
// Tasks' list comes from its own help dialog so it can't drift; the others mirror the handlers they name
// (Shell.tsx, CalendarPage/EventSearch/EventPeek, HabitsPage, ContactsPage, PhotosPage/Viewer/select/Games,
// PlacesPage, notifications/Inbox). Update this list when one of those changes.
import { APPS } from '../../components/nav'
import { HELP as TASKS_HELP } from '../tasks/Shortcuts'

export type ShortcutGroup = [title: string, rows: [keys: string, label: string][]]

const TASKS_TITLES: Record<string, string> = {
  General: 'Tasks',
  Tasks: 'Tasks: in the list',
  'Go to': 'Tasks: go to',
  Layout: 'Tasks: layout',
}

export const SHORTCUTS: ShortcutGroup[] = [
  [
    'Everywhere',
    [
      ['Ctrl K', 'Search or jump to'],
      ['/', 'Search'],
      ['q', 'New task'],
      ...APPS.filter((a) => a.key).map((a): [string, string] => [`g ${a.key}`, `Go to ${a.label}`]),
    ],
  ],
  [
    'Calendar',
    [
      ['t', 'Today'],
      ['j / k', 'Next / previous (also → ←, . ,)'],
      ['Ctrl ← / →', 'Previous / next'],
      ['Ctrl Shift ← / →', 'A year back / forward'],
      ['m', 'Month'],
      ['w', 'Week'],
      ['d', 'Day'],
      ['a', 'Agenda'],
      ['n', 'New event'],
      ['c', 'New event at the next quarter hour'],
      ['q', 'Add a task'],
      ['s', 'Subscribe to a calendar'],
      ['i', 'Insights'],
      ['/', 'Search events'],
      ['e', 'Edit the open event'],
      ['Del', 'Delete the open event'],
    ],
  ],
  ...TASKS_HELP.map(([title, rows]): ShortcutGroup => [TASKS_TITLES[title] ?? `Tasks: ${title}`, rows]),
  [
    'Habits',
    [
      ['n', 'New habit'],
      ['t', 'Today'],
      ['w', 'Progress grid'],
      ['j / k', 'Move between habits (or ↓ ↑)'],
      ['Space', 'Check off, or add to a measurable habit'],
      ['+ / −', 'Add / subtract (measurable)'],
      ['s', 'Skip or unskip today'],
      ['Enter', 'Open stats and history'],
      ['e', 'Edit the habit'],
      ['Alt ↑ ↓', 'Move the habit up / down'],
      ['Esc', 'Back from a habit / close'],
      ['?', 'Habits shortcuts'],
    ],
  ],
  [
    'Contacts',
    [
      ['/', 'Search contacts'],
      ['n', 'New contact'],
      ['j / k', 'Next / previous contact (or ↓ ↑)'],
      ['e', 'Edit the open contact'],
      ['Esc', 'Clear the search'],
    ],
  ],
  [
    'Photos',
    [
      ['Shift H', 'Show / hide hidden photos'],
      ['← / →', 'Previous / next photo'],
      ['+ / −', 'Zoom in / out'],
      ['0', 'Reset zoom'],
      ['i', 'Photo info'],
      ['Esc', 'Close the photo, or leave selecting'],
      ['Del', 'Delete the selected photos'],
      ['Enter', 'Geoguessr: guess, then next round'],
      ['n', 'Geoguessr: next round'],
      ['Enter', 'Locate: save the location'],
      ['s', 'Locate: skip the photo'],
    ],
  ],
  ['Places', [['Esc', 'Stop adding a place']]],
  [
    'Notifications',
    [
      ['j / k', 'Next / previous'],
      ['Enter', 'Open'],
      ['e', 'Read / unread'],
      ['#', 'Delete'],
    ],
  ],
]
