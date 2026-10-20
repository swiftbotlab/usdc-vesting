import React, { useMemo } from 'react'
import type { RawSchedule, RawTranche } from '../lib/vesting'

interface VestingChartProps {
  schedule: RawSchedule
  tranches: RawTranche[]
  nowSec: number
  claimedMarkers?: number[] // unix seconds of claim events
  height?: number
}

function fmtAxisDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: '2-digit',
  })
}

export function VestingChart({ schedule, tranches, nowSec, claimedMarkers = [], height = 120 }: VestingChartProps) {
  const W = 400
  const H = height
  const PAD = { top: 12, right: 12, bottom: 32, left: 12 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom

  const start = Number(schedule.start)
  const cancelledAt = schedule.cancelledAt !== 0n ? Number(schedule.cancelledAt) : null

  // The effective end for the chart: cancelled schedules stop at cancelledAt
  const chartEnd = cancelledAt ? Math.max(cancelledAt, start + 1) : Number(schedule.end)
  const cliff = Number(schedule.cliff)
  const duration = chartEnd - start

  const toX = (t: number) => PAD.left + Math.max(0, Math.min(1, duration > 0 ? (t - start) / duration : 0)) * cw
  const toY = (frac: number) => PAD.top + (1 - Math.max(0, Math.min(1, frac))) * ch

  // Vested fraction at any time (mirrors contract formula, frozen at cancelledAt)
  function vestedFracAt(atSec: number): number {
    const effective = cancelledAt ? Math.min(atSec, cancelledAt) : atSec
    if (schedule.kind === 0) {
      const end = Number(schedule.end)
      const rawDuration = end - start
      if (rawDuration <= 0) return 0
      if (effective < cliff) return 0
      if (effective >= end) return 1
      return (effective - start) / rawDuration
    } else {
      const total = Number(schedule.total)
      if (total === 0) return 0
      let sum = 0
      for (const tr of tranches) {
        if (Number(tr.time) <= effective) sum += Number(tr.amount)
      }
      return sum / total
    }
  }

  const pathD = useMemo(() => {
    if (schedule.kind === 0) {
      // Linear — stops flat at cancelledAt
      const end = Number(schedule.end)
      const rawDuration = end - start
      if (rawDuration <= 0) return ''
      const normX = (t: number) => PAD.left + Math.max(0, Math.min(1, (t - start) / duration)) * cw
      const normY = (frac: number) => PAD.top + (1 - Math.max(0, Math.min(1, frac))) * ch
      const pts: string[] = [`M ${normX(start)} ${normY(0)}`]
      if (cliff > start) {
        pts.push(`L ${normX(cliff)} ${normY(0)}`)
        // At cliff, vested fraction jumps up
        const vestedAtCliff = (cliff - start) / rawDuration
        pts.push(`L ${normX(cliff)} ${normY(vestedAtCliff)}`)
      }
      if (cancelledAt) {
        const vestedAtCancel = Math.min(1, cancelledAt >= end ? 1 : (cancelledAt - start) / rawDuration)
        pts.push(`L ${normX(cancelledAt)} ${normY(vestedAtCancel)}`)
        // Flat line to chartEnd (which is cancelledAt)
      } else {
        pts.push(`L ${normX(end)} ${normY(1)}`)
      }
      return pts.join(' ')
    } else {
      // Tranches — each step frozen at cancelledAt
      const total = Number(schedule.total)
      if (total === 0) return ''
      let cum = 0
      const pts: string[] = [`M ${toX(start)} ${toY(0)}`]
      for (const tr of tranches) {
        const t = Number(tr.time)
        if (cancelledAt && t > cancelledAt) break
        pts.push(`L ${toX(t)} ${toY(cum / total)}`)
        cum += Number(tr.amount)
        pts.push(`L ${toX(t)} ${toY(cum / total)}`)
      }
      if (cancelledAt) {
        // Flat to cancelledAt
        pts.push(`L ${toX(cancelledAt)} ${toY(cum / total)}`)
      }
      return pts.join(' ')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, tranches, start, chartEnd, cliff, cancelledAt, duration])

  const nowX = toX(Math.min(nowSec, chartEnd))
  const vestedFracNow = vestedFracAt(nowSec)

  // X-axis label positions: start, cliff (if linear), end/cancelledAt
  const xLabels: { x: number; label: string }[] = []
  xLabels.push({ x: toX(start), label: fmtAxisDate(start) })
  if (schedule.kind === 0 && cliff > start && cliff < chartEnd) {
    const cliffX = toX(cliff)
    // Only show cliff label if it doesn't collide with start
    if (cliffX - toX(start) > 40) {
      xLabels.push({ x: cliffX, label: fmtAxisDate(cliff) })
    }
  }
  const endTs = cancelledAt ?? Number(schedule.end)
  const endX = toX(endTs)
  if (endX - (xLabels[xLabels.length - 1]?.x ?? 0) > 40) {
    xLabels.push({ x: endX, label: (cancelledAt ? '✕ ' : '') + fmtAxisDate(endTs) })
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

      {/* Cliff marker (linear only, pre-cancel) */}
      {schedule.kind === 0 && cliff > start && (!cancelledAt || cliff <= cancelledAt) && (
        <line
          x1={toX(cliff)} y1={PAD.top}
          x2={toX(cliff)} y2={PAD.top + ch}
          stroke="#4f5766" strokeWidth="1" strokeDasharray="3,3"
        />
      )}

      {/* Vested area fill */}
      {pathD && (
        <path
          d={`${pathD} L ${toX(chartEnd)} ${toY(0)} L ${toX(start)} ${toY(0)} Z`}
          fill="rgba(229,62,62,0.08)"
        />
      )}

      {/* Vested curve */}
      {pathD && (
        <path d={pathD} fill="none" stroke="#e53e3e" strokeWidth="2" strokeLinejoin="round" />
      )}

      {/* cancelledAt line */}
      {cancelledAt && (
        <>
          <line
            x1={toX(cancelledAt)} y1={PAD.top}
            x2={toX(cancelledAt)} y2={PAD.top + ch}
            stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,3"
          />
          <text
            x={toX(cancelledAt) + 3} y={PAD.top + 10}
            fontSize="8" fill="#ef4444" fontFamily="system-ui,sans-serif"
          >
            cancelled
          </text>
        </>
      )}

      {/* Now marker */}
      {nowSec >= start && nowSec <= chartEnd + 86400 && (
        <>
          <line
            x1={nowX} y1={PAD.top}
            x2={nowX} y2={PAD.top + ch}
            stroke="rgba(241,243,247,0.3)" strokeWidth="1"
          />
          <circle cx={nowX} cy={toY(vestedFracNow)} r={4} fill="#e53e3e" stroke="#0a0c10" strokeWidth="2" />
        </>
      )}

      {/* Claim markers — placed on the vesting curve at the claim time */}
      {claimedMarkers.map((ts, i) => {
        const claimX = toX(ts)
        const claimY = toY(vestedFracAt(ts))
        return (
          <circle
            key={i}
            cx={claimX}
            cy={claimY}
            r={3}
            fill="#22c55e"
            stroke="#0a0c10"
            strokeWidth="1.5"
          />
        )
      })}

      {/* X-axis labels */}
      {xLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={H - 4}
          fontSize="9"
          fill="#4f5766"
          fontFamily="system-ui,sans-serif"
          textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
        >
          {l.label}
        </text>
      ))}
    </svg>
  )
}
