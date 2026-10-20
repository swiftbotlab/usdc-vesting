import type { ScheduleStatus } from '../lib/vesting'

const BADGE: Record<ScheduleStatus, { label: string; cls: string }> = {
  None:      { label: 'Unknown',   cls: 'bg-surface-3 text-text-muted' },
  Active:    { label: 'Active',    cls: 'bg-success-muted text-success' },
  Completed: { label: 'Completed', cls: 'bg-surface-3 text-text-secondary' },
  Cancelled: { label: 'Cancelled', cls: 'bg-error-muted text-error' },
}

export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const b = BADGE[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-chip text-xs font-medium ${b.cls}`}>
      {b.label}
    </span>
  )
}
