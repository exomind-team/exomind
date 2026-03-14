import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LogPanel } from '@/ui/app/components/settings/LogPanel'

export function LogPanelDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-log-panel', handler)
    return () => window.removeEventListener('open-log-panel', handler)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>调试日志</DialogTitle>
        </DialogHeader>
        <LogPanel />
      </DialogContent>
    </Dialog>
  )
}
