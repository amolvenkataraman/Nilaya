// Permanently delete photos (files, originals and RAW): typing DELETE confirms, since it can't be undone.
import { useState } from 'react'
import { toast } from '../../components/toast'
import { Button, Dialog, Field, Input } from '../../components/ui'
import { post } from '../../lib/api'

export function DeleteDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const n = ids.length
  const run = async () => {
    setBusy(true)
    try {
      const r = await post<{ deleted: number }>('photos/delete', { ids })
      if (!r.deleted) toast.error('Nothing was deleted. You can only delete from libraries you own or edit.')
      else
        toast.show(
          `Deleted ${r.deleted} item${r.deleted === 1 ? '' : 's'}${r.deleted < n ? ` (${n - r.deleted} skipped: libraries you can only view)` : ''}`,
        )
      onDone()
      onClose()
    } catch (e) {
      toast.fail(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Permanently delete ${n} item${n === 1 ? '' : 's'}?`}
      width="28rem"
      footer={
        <>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid-danger" disabled={typed !== 'DELETE' || busy} onClick={run}>
            {busy ? 'Deleting…' : 'Delete forever'}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        This removes the files from disk, including originals and RAW files. It can't be undone. To keep them out of sight instead, use{' '}
        <strong>Hide</strong>.
      </p>
      <Field
        label={
          <>
            Type <strong>DELETE</strong> to confirm
          </>
        }
      >
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
      </Field>
    </Dialog>
  )
}
