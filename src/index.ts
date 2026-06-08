import { parseExpression } from 'cron-parser'
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
        onInvalidCron: (error) => logger.warn(
            `???? cron ???${formatCronExpression(config.autoAnalysisCron)}?${formatError(error)}`
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
        onInvalidCron?: (error: unknown) => void
        onNextRun?: (nextRunAt: Date, initial: boolean) => void
    } = {}
) {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const scheduleNext = (initial = false): Date | undefined => {
        if (disposed) return

        let nextRunAt: Date | undefined
        try {
            nextRunAt = getNextCronRunAt(cron)
        } catch (error) {
            hooks.onInvalidCron?.(error)
            return
        }

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

function getNextCronRunAt(cron: string) {
    return parseExpression(normalizeCronExpression(cron)).next().toDate()
}

function normalizeCronExpression(expression: string) {
    const fields = expression.trim().split(/\s+/).filter(Boolean)
    if (fields.length === 5) return `0 ${fields.join(' ')}`
    if (fields.length === 6) return fields.join(' ')
    throw new Error(`cron ?????? 5 ?? 6 ????? ${fields.length} ?`)
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
