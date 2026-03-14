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
      <DialogContent className="max-w-4xl rounded-2xl border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
        <DialogHeader>
          <DialogTitle className="text-[#1C1917] dark:text-[#FAFAF9]">调试日志</DialogTitle>
        </DialogHeader>
        <LogPanel />
      </DialogContent>
    </Dialog>
  )
}
