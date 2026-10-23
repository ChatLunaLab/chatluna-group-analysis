import { Context } from 'koishi'
import { CronExpressionParser } from 'cron-parser'
import type { CronExpression } from 'cron-parser'

const MINUTE_MS = 60 * 1000

export function cron(
    ctx: Context,
    pattern: string,
    callback: () => void | Promise<void>,
    options: CronOptions = {}
) {
    const expr = CronExpressionParser.parse(pattern)
    const logger = ctx.logger(options.name || 'cron')
    const cooldown = Math.max(0, options.cooldown || 0) * MINUTE_MS
    const pollInterval = Math.max(1, options.cooldown || 1) * MINUTE_MS
    let disposed = false
    let running = false
    let lastTriggeredAt = 0
    let disposeTimer: (() => void) | undefined
    let nextRunAt = getNextRunAt(expr)

    const schedule = () => {
        if (disposed) return
        const delay = Math.max(
            0,
            Math.min(nextRunAt - Date.now(), pollInterval)
        )
        disposeTimer = ctx.setTimeout(async () => {
            disposeTimer = undefined
            if (disposed) return

            if (Date.now() >= nextRunAt) {
                await trigger()
                nextRunAt = getNextRunAt(expr)
            }
            schedule()
        }, delay)
    }

    const trigger = async () => {
        const now = Date.now()
        if (
            running ||
            (cooldown && lastTriggeredAt && now - lastTriggeredAt < cooldown)
        )
            return

        running = true
        lastTriggeredAt = now
        try {
            await callback()
        } catch (error) {
            logger.warn(error)
        } finally {
            running = false
        }
    }

    schedule()
    return () => {
        disposed = true
        if (disposeTimer) disposeTimer()
    }
}

interface CronOptions {
    cooldown?: number
    name?: string
}

function getNextRunAt(expr: CronExpression) {
    expr.reset(new Date())
    return expr.next().getTime()
}
