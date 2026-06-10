import { Context } from 'koishi'
import { CronExpressionParser } from 'cron-parser'
import type { CronExpression } from 'cron-parser'

const DEFAULT_POLL_INTERVAL_MINUTES = 1
const MINUTE_MS = 60 * 1000

export function cron(
    ctx: Context,
    pattern: string,
    callback: () => void | Promise<void>,
    pollIntervalMinutes = DEFAULT_POLL_INTERVAL_MINUTES
) {
    const expr = CronExpressionParser.parse(pattern)
    const pollIntervalMs = Math.max(1, pollIntervalMinutes) * MINUTE_MS
    let disposed = false
    let disposeTimer: (() => void) | undefined
    let nextRunAt = getNextRunAt(expr)

    const schedule = () => {
        if (disposed) return

        const delay = Math.max(
            0,
            Math.min(nextRunAt - Date.now(), pollIntervalMs)
        )

        disposeTimer = ctx.setTimeout(async () => {
            disposeTimer = undefined
            if (disposed) return

            if (Date.now() >= nextRunAt) {
                try {
                    await callback()
                } catch (error) {
                    ctx.logger('cron').warn(error)
                }

                nextRunAt = getNextRunAt(expr)
            }

            schedule()
        }, delay)
    }

    schedule()

    return () => {
        disposed = true
        disposeTimer?.()
    }
}

function getNextRunAt(expr: CronExpression) {
    expr.reset(new Date())
    return expr.next().getTime()
}
