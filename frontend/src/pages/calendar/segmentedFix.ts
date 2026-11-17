// Two slips in the shared Segmented control: its buttons don't reset the browser's button border and background
// (there's no preflight), so unselected options look like raised buttons; and the selected one gets both
// text-muted and text-fg, where muted wins. Until components/ui/controls.tsx fixes both, calendar callers pass
// this; then delete this file.
export const SEGMENTED_FIX = '[&>button]:border-0 [&>button[aria-pressed=false]]:bg-transparent [&>button[aria-pressed=true]]:text-fg'
