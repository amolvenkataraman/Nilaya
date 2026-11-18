// Habit settings: the evening nudge ("2 habits left today") and when it's sent. Shared with
// Notifications › Reminders through one cached copy; changes save straight away.
import { Button, Dialog, Input, PanelRow, QueryView, Switch } from '../../components/ui'
import { useHabitSettings, useSaveHabitSettings } from './api'

export function HabitSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useHabitSettings()
  const save = useSaveHabitSettings()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Habit settings"
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <QueryView query={settings} skeleton={<span className="my-2 block h-3 animate-pulse rounded-xs bg-surface-2" />}>
        {(s) => (
          <div className="grid gap-3">
            <PanelRow label="Evening nudge" help={'A notification like "2 habits left today" if you haven\'t finished.'}>
              <Switch checked={s.evening_nudge} onChange={(v) => save.mutate({ evening_nudge: v })} ariaLabel="Evening nudge" />
            </PanelRow>
            {s.evening_nudge && (
              <label className="flex items-center gap-2 text-sm" htmlFor="h-nudge-time">
                <span className="min-w-0 flex-auto">Send at</span>
                <Input
                  id="h-nudge-time"
                  width="content"
                  className="w-28"
                  type="time"
                  defaultValue={s.nudge_time.slice(0, 5)}
                  onBlur={(e) => e.target.value && save.mutate({ nudge_time: e.target.value + ':00' })}
                />
              </label>
            )}
          </div>
        )}
      </QueryView>
    </Dialog>
  )
}
