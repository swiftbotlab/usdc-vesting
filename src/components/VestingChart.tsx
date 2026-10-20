import React, { useMemo } from 'react'
import type { RawSchedule, RawTranche } from '../lib/vesting'

interface VestingChartProps {
  schedule: RawSchedule
  tranches: RawTranche[]
  nowSec: number
  claimedMarkers?: number[] // unix seconds of claim events
  height?: number
}

export function VestingChart({ schedule, tranches, nowSec, claimedMarkers = [], height = 120 }: VestingChartProps) {
  const W = 400
  const H = height
  const PAD = { top: 12, right: 12, bottom: 24, left: 12 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom

  const start = Number(schedule.start)
  const end = Number(schedule.end)
  const cliff = Number(schedule.cliff)
  const cancelledAt = schedule.cancelledAt !== 0n ? Number(schedule.cancelledAt) : null
  const duration = end - start

  const toX = (t: number) => PAD.left + Math.max(0, Math.min(1, (t - start) / duration)) * cw
  const toY = (frac: number) => PAD.top + (1 - Math.max(0, Math.min(1, frac))) * ch

  const pathD = useMemo(() => {
    if (schedule.kind === 0) {
      // Linear
      const pts: [number, number][] = [[start, 0]]
      if (cliff > start) {
        pts.push([cliff, 0])
      }
      pts.push([end, 1])
      return pts.map(([t, y], i) => `${i === 0 ? 'M' : 'L'} ${toX(t)} ${toY(y)}`).join(' ')
    } else {
      // Tranches
      const total = Number(schedule.total)
      if (total === 0) return ''
      let cum = 0
      const pts: string[] = [`M ${toX(start)} ${toY(0)}`]
      for (const tr of tranches) {
        const t = Number(tr.time)
        pts.push(`L ${toX(t)} ${toY(cum / total)}`)
        cum += Number(tr.amount)
        pts.push(`L ${toX(t)} ${toY(cum / total)}`)
      }
      return pts.join(' ')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, tranches, start, end, cliff, toX, toY])

  const nowX = toX(Math.min(nowSec, end))
  const effectiveNow = cancelledAt ? Math.min(nowSec, cancelledAt) : nowSec

  // Vested fraction at now
  let vestedFrac = 0
  if (schedule.kind === 0) {
    if (effectiveNow >= end) vestedFrac = 1
    else if (effectiveNow >= cliff && duration > 0) {
      vestedFrac = (effectiveNow - start) / duration
    }
  } else {
    const total = Number(schedule.total)
    if (total > 0) {
      let sum = 0
      for (const tr of tranches) {
        if (Number(tr.time) <= effectiveNow) sum += Number(tr.amount)
      }
      vestedFrac = sum / total
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="overflow-visible"
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={PAD.left} y1={toY(f)}
          x2={PAD.left + cw} y2={toY(f)}
          stroke="#252b38" strokeWidth="1"
        />
      ))}

      {/* Cliff marker */}
      {schedule.kind === 0 && cliff > start && (
        <line
          x1={toX(cliff)} y1={PAD.top}
          x2={toX(cliff)} y2={PAD.top + ch}
          stroke="#4f5766" strokeWidth="1" strokeDasharray="3,3"
        />
      )}

      {/* Vested area fill */}
      {pathD && (
        <path
          d={`${pathD} L ${toX(end)} ${toY(0)} L ${toX(start)} ${toY(0)} Z`}
          fill="rgba(229,62,62,0.08)"
        />
      )}

      {/* Vested curve */}
      {pathD && (
        <path d={pathD} fill="none" stroke="#e53e3e" strokeWidth="2" strokeLinejoin="round" />
      )}

      {/* cancelledAt line */}
      {cancelledAt && (
        <line
          x1={toX(cancelledAt)} y1={PAD.top}
          x2={toX(cancelledAt)} y2={PAD.top + ch}
          stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,3"
        />
      )}

      {/* Now marker */}
      {nowSec >= start && nowSec <= end + 86400 && (
        <>
          <line
            x1={nowX} y1={PAD.top}
            x2={nowX} y2={PAD.top + ch}
            stroke="rgba(241,243,247,0.3)" strokeWidth="1"
          />
          <circle cx={nowX} cy={toY(vestedFrac)} r={4} fill="#e53e3e" stroke="#0a0c10" strokeWidth="2" />
        </>
      )}

      {/* Claim markers */}
      {claimedMarkers.map((ts, i) => (
        <circle
          key={i}
          cx={toX(ts)}
          cy={toY(0)}
          r={3}
          fill="#22c55e"
          stroke="#0a0c10"
          strokeWidth="1.5"
        />
      ))}

      {/* X-axis labels */}
      <text x={PAD.left} y={H - 4} fontSize="9" fill="#4f5766" fontFamily="JetBrains Mono">
        start
      </text>
      <text x={PAD.left + cw} y={H - 4} fontSize="9" fill="#4f5766" fontFamily="JetBrains Mono" textAnchor="end">
        end
      </text>
    </svg>
  )
}
