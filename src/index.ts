import { Context } from 'koishi'

import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { RendererService } from './service/renderer'
import { MessageService } from './service/message'
import { plugin } from './plugin'
import type {} from 'koishi-plugin-puppeteer'
import type { Config as GroupAnalysisConfig } from './config'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import { cron } from './cron'

export * from './config'
export * from './service/message'

const DEFAULT_AUTO_ANALYSIS_COOLDOWN_MINUTES = 1
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

    if (!config.cronSchedule?.trim()) {
        return () => {}
    }

    const dispose = cron(
        ctx,
        config.cronSchedule,
        async () => {
            try {
                await executeAutoAnalysis(ctx, config)
            } catch (error) {
                logger.warn(`自动分析执行失败：${formatError(error)}`)
            }
        },
        getAutoAnalysisCooldownMinutes(config)
    )

    return () => {
        autoAnalysisRunning = false
        lastAutoAnalysisTriggerAt = undefined
        dispose()
    }
}

async function executeAutoAnalysis(ctx: Context, config: GroupAnalysisConfig) {
    const logger = ctx.logger('chatluna-group-analysis')

    if (autoAnalysisRunning) {
        logger.warn('自动分析已跳过：上一轮仍在执行')
        return
    }

    const cooldownMinutes = getAutoAnalysisCooldownMinutes(config)
    const nowMs = Date.now()

    if (cooldownMinutes > 0 && lastAutoAnalysisTriggerAt !== undefined) {
        const minIntervalMs = cooldownMinutes * 60 * 1000
        const elapsedMs = nowMs - lastAutoAnalysisTriggerAt

        if (elapsedMs < minIntervalMs) {
            return
        }
    }

    if (cooldownMinutes > 0) {
        lastAutoAnalysisTriggerAt = nowMs
    }

    autoAnalysisRunning = true
    try {
        await ctx.chatluna_group_analysis.executeAutoAnalysisForEnabledGroups()
    } finally {
        autoAnalysisRunning = false
    }
}

function getAutoAnalysisCooldownMinutes(config: GroupAnalysisConfig) {
    return Math.max(
        0,
        config.autoAnalysisCooldown ?? DEFAULT_AUTO_ANALYSIS_COOLDOWN_MINUTES
    )
}

function formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}
