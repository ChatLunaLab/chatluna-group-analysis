import { Context } from 'koishi'

import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { RendererService } from './service/renderer'
import { MessageService } from './service/message'
import { plugin } from './plugin'
import type {} from 'koishi-plugin-puppeteer'
import { Config } from './config'
import type { Config as GroupAnalysisConfig } from './config'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'

export * from './config'
export * from './service/message'

const MAX_SAFE_DELAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MIN_TRIGGER_INTERVAL_SECONDS = 60
let autoAnalysisRunning = false
let lastAutoAnalysisTriggerAt: number | undefined

export function apply(ctx: Context, config: GroupAnalysisConfig) {
    ctx.plugin(MessageService, config)
    ctx.plugin(LLMService, config)
    ctx.plugin(AnalysisService, config)
    ctx.plugin(RendererService, config)

    ctx.inject(
        [
            'chatluna_group_analysis_message',
            'chatluna_group_analysis_llm',
            'chatluna_group_analysis_renderer'
        ],
        (ctx) => {
            plugin(ctx, config)
        }
    )

    ctx.inject(['chatluna_group_analysis'], (ctx) => {
        ctx.effect(() => scheduleAutoAnalysis(ctx, config))
    })

    modelSchema(ctx)
}

function scheduleAutoAnalysis(ctx: Context, config: GroupAnalysisConfig) {
    const logger = ctx.logger('chatluna-group-analysis')
    const legacyCron = (config as { cronSchedule?: unknown }).cronSchedule
    const legacySchedule = (config as { autoAnalysisSchedule?: unknown }).autoAnalysisSchedule
    const legacyTupleCron = Array.isArray((config as { autoAnalysisCron?: unknown }).autoAnalysisCron)

    if (!config.autoAnalysisCron || legacyTupleCron) {
        if (legacyTupleCron) {
            logger.warn('autoAnalysisCron 已从五元组改为字符串，请改为类似 0 22 * * * 的五位 cron 表达式')
        } else if (typeof legacyCron === 'string' && legacyCron.trim()) {
            logger.warn(
                `cronSchedule 已不再支持，请迁移到 autoAnalysisCron，cronSchedule=${legacyCron}`
            )
        } else if (legacySchedule) {
            logger.warn('autoAnalysisSchedule 已不再支持，请迁移到 autoAnalysisCron')
        }
        return () => {}
    }

    const task = createSafeCronTask(config.autoAnalysisCron, async () => {
        try {
            await executeAutoAnalysis(ctx, config)
        } catch (error) {
            logger.warn(`?????????${formatError(error)}`)
        }
    }, {
        onMissingNextRun: () => logger.warn(
            `???? cron ??????????????${formatCronExpression(config.autoAnalysisCron)}`
        ),
        onNextRun: (nextRunAt, initial) => {
            if (initial) {
                logger.info(
                    `????????cron=${formatCronExpression(config.autoAnalysisCron)}?nextRunAt=${formatDateTime(nextRunAt)}`
                )
            } else {
                logger.info(`??????????? ${formatDateTime(nextRunAt)}`)
            }
        }
    })

    return () => {
        autoAnalysisRunning = false
        lastAutoAnalysisTriggerAt = undefined
        task?.dispose()
    }
}

async function executeAutoAnalysis(ctx: Context, config: GroupAnalysisConfig) {
    const logger = ctx.logger('chatluna-group-analysis')

    if (autoAnalysisRunning) {
        logger.warn('自动分析已跳过：上一轮仍在执行')
        return
    }

    const minTriggerIntervalSeconds = Math.max(
        0,
        config.autoAnalysisMinTriggerIntervalSeconds
            ?? DEFAULT_MIN_TRIGGER_INTERVAL_SECONDS
    )
    const nowMs = Date.now()

    if (minTriggerIntervalSeconds > 0 && lastAutoAnalysisTriggerAt !== undefined) {
        const minIntervalMs = minTriggerIntervalSeconds * 1000
        const elapsedMs = nowMs - lastAutoAnalysisTriggerAt

        if (elapsedMs < minIntervalMs) {
            const remainingSeconds = Math.ceil((minIntervalMs - elapsedMs) / 1000)
            logger.warn(
                `自动分析已跳过：全局最小触发间隔仍在生效，remaining=${remainingSeconds}s，minInterval=${minTriggerIntervalSeconds}s`
            )
            return
        }
    }

    if (minTriggerIntervalSeconds > 0) {
        lastAutoAnalysisTriggerAt = nowMs
    }

    autoAnalysisRunning = true
    try {
        await ctx.chatluna_group_analysis.executeAutoAnalysisForEnabledGroups()
    } finally {
        autoAnalysisRunning = false
    }
}

function createSafeCronTask(
    cron: string,
    onTrigger: () => Promise<void>,
    hooks: {
        onMissingNextRun?: () => void
        onNextRun?: (nextRunAt: Date, initial: boolean) => void
    } = {}
) {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const scheduleNext = (initial = false): Date | undefined => {
        if (disposed) return

        const nextRunAt = getNextCronRunAt(cron, new Date())
        if (!nextRunAt) {
            hooks.onMissingNextRun?.()
            return
        }

        hooks.onNextRun?.(nextRunAt, initial)
        waitUntil(nextRunAt)
        return nextRunAt
    }

    const waitUntil = (targetTime: Date) => {
        if (disposed) return

        const remainingMs = targetTime.getTime() - Date.now()
        if (remainingMs <= 0) {
            void onTrigger().finally(() => scheduleNext())
            return
        }

        timer = setTimeout(() => waitUntil(targetTime), Math.min(remainingMs, MAX_SAFE_DELAY_MS))
    }

    const nextRunAt = scheduleNext(true)
    if (!nextRunAt) return

    return {
        nextRunAt,
        dispose: () => {
            disposed = true
            if (timer) clearTimeout(timer)
        }
    }
}

type CronField = {
    values: Set<number>
    wildcard: boolean
}

type ParsedCron = {
    minute: CronField
    hour: CronField
    dayOfMonth: CronField
    month: CronField
    dayOfWeek: CronField
}

function getNextCronRunAt(cron: string, now: Date) {
    const parsed = parseCron(cron)
    const start = new Date(now.getTime() + 60 * 1000)
    start.setSeconds(0, 0)

    const deadline = new Date(now)
    deadline.setFullYear(deadline.getFullYear() + 8)
    deadline.setSeconds(59, 999)

    for (const candidate = start; candidate <= deadline; candidate.setMinutes(candidate.getMinutes() + 1)) {
        if (matchesCron(candidate, parsed)) return new Date(candidate)
    }
}

function parseCron(expression: string): ParsedCron {
    const fields = expression.trim().split(/\s+/).filter(Boolean)
    if (fields.length !== 5) {
        throw new Error(`cron ?????? 5 ???? ?? ?? ?? ?????? ${fields.length} ?`)
    }

    return {
        minute: parseField(fields[0], 0, 59),
        hour: parseField(fields[1], 0, 23),
        dayOfMonth: parseField(fields[2], 1, 31),
        month: parseField(fields[3], 1, 12),
        dayOfWeek: parseField(fields[4], 0, 7, (value) => value === 7 ? 0 : value)
    }
}

function parseField(
    source: string,
    min: number,
    max: number,
    normalize: (value: number) => number = (value) => value
): CronField {
    const field = source.trim()
    if (!field) throw new Error('cron field cannot be empty')

    const values = new Set<number>()
    for (const part of field.split(',')) {
        const match = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/.exec(part.trim())
        if (!match) throw new Error(`unsupported cron field syntax: ${part}`)

        const step = match[2] ? Number(match[2]) : 1
        if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`)

        const [start, end] = match[1] === '*'
            ? [min, max]
            : match[1].includes('-')
                ? match[1].split('-').map(Number)
                : [Number(match[1]), Number(match[1])]

        if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
            throw new Error(`cron value out of range: ${part}`)
        }

        for (let value = start; value <= end; value += step) {
            values.add(normalize(value))
        }
    }

    if (!values.size) throw new Error(`cron field has no values: ${source}`)
    return { values, wildcard: field === '*' }
}

function matchesCron(date: Date, cron: ParsedCron) {
    if (!cron.minute.values.has(date.getMinutes())) return false
    if (!cron.hour.values.has(date.getHours())) return false
    if (!cron.month.values.has(date.getMonth() + 1)) return false

    const dayOfMonthMatches = cron.dayOfMonth.values.has(date.getDate())
    const dayOfWeekMatches = cron.dayOfWeek.values.has(date.getDay())

    if (cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard) return true
    if (cron.dayOfMonth.wildcard) return dayOfWeekMatches
    if (cron.dayOfWeek.wildcard) return dayOfMonthMatches
    return dayOfMonthMatches || dayOfWeekMatches
}

function formatCronExpression(cron?: string) {
    return cron?.trim().replace(/\s+/g, '_') || 'missing-cron'
}

function formatDateTime(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')

    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}
