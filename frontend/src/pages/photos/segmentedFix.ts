// Segmented's buttons carry no border or background reset, and there is no preflight, so the browser's button
// border and grey fill show through. Until components/ui/controls.tsx resets them, Photos passes this.
export const segmentedFix = '[&>button]:border-0 [&>button]:bg-transparent [&>button]:aria-pressed:bg-surface'
