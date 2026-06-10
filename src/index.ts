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
    if (!config.cronSchedule?.trim()) {
        return () => {}
    }

    return cron(
        ctx,
        config.cronSchedule,
        () => ctx.chatluna_group_analysis.executeAutoAnalysisForEnabledGroups(),
        {
            cooldown: config.autoAnalysisCooldown,
            name: 'chatluna-group-analysis'
        }
    )
}
