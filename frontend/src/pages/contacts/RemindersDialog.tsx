// Contact reminders (birthdays, keep in touch): the same settings as Notifications › Reminders, sharing its
// cached copy. Changes save straight away.
import { Button, Dialog, QueryView, Select, SkeletonRows, Switch } from '../../components/ui'
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
            <label className="flex items-center gap-3" htmlFor="c-birthday-reminders">
              <Setting title="Birthdays" help="A heads-up for each contact's birthday" />
              <Select
                id="c-birthday-reminders"
                className="w-auto!"
                value={s.birthday_reminders}
                onChange={(e) => save.mutate({ birthday_reminders: e.target.value as ContactSettings['birthday_reminders'] })}
              >
                <option value="day_before">The day before</option>
                <option value="on_day">On the day</option>
                <option value="off">Off</option>
              </Select>
            </label>
            <div className="flex items-center gap-3">
              <Setting title="Keep in touch" help="When someone you keep in touch with is due" />
              <Switch
                checked={s.keep_in_touch_reminders}
                onChange={(v) => save.mutate({ keep_in_touch_reminders: v })}
                label={<span className="sr-only">Keep in touch reminders</span>}
              />
            </div>
          </div>
        )}
      </QueryView>
    </Dialog>
  )
}

function Setting({ title, help }: { title: string; help: string }) {
  return (
    <span className="min-w-0 flex-auto">
      <span className="text-sm font-medium">{title}</span>
      <span className="block text-xs text-muted">{help}</span>
    </span>
  )
}
