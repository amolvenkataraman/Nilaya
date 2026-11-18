// Contact reminders (birthdays, keep in touch): the same settings as Notifications › Reminders, sharing its
// cached copy. Changes save straight away.
import { Button, Dialog, PanelRow, QueryView, Select, SkeletonRows, Switch } from '../../components/ui'
import { useContactSettings, useSaveContactSettings, type ContactSettings } from './api'

export function RemindersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useContactSettings(open)
  const save = useSaveContactSettings()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reminders"
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <QueryView query={settings} skeleton={<SkeletonRows rows={2} />}>
        {(s) => (
          <div className="grid gap-3.5">
            <p className="text-sm text-muted">
              Sent once each morning to your notification inbox and delivery channels. Changes save straight away.
            </p>
            <PanelRow label="Birthdays" help="A heads-up for each contact's birthday" htmlFor="c-birthday-reminders">
              <Select
                id="c-birthday-reminders"
                width="content"
                value={s.birthday_reminders}
                onChange={(e) => save.mutate({ birthday_reminders: e.target.value as ContactSettings['birthday_reminders'] })}
              >
                <option value="day_before">The day before</option>
                <option value="on_day">On the day</option>
                <option value="off">Off</option>
              </Select>
            </PanelRow>
            <PanelRow label="Keep in touch" help="When someone you keep in touch with is due">
              <Switch
                checked={s.keep_in_touch_reminders}
                onChange={(v) => save.mutate({ keep_in_touch_reminders: v })}
                ariaLabel="Keep in touch reminders"
              />
            </PanelRow>
          </div>
        )}
      </QueryView>
    </Dialog>
  )
}
