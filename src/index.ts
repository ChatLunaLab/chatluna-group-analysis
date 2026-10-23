import { Context } from 'koishi'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'
import type {} from 'koishi-plugin-puppeteer'
import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { MessageService } from './service/message'
import { PersonaService } from './service/persona'
import { RendererService } from './service/renderer'
import { Config as GroupAnalysisConfig } from './config'
import { plugin } from './plugin'
import { cron } from './utils/cron'

export * from './config'
export * from './service/message'

export function apply(ctx: Context, config: GroupAnalysisConfig) {
    ctx.plugin(MessageService, config)
    ctx.plugin(LLMService, config)
    ctx.plugin(RendererService, config)
    ctx.plugin(PersonaService, config)
    ctx.plugin(AnalysisService, config)

    plugin(ctx, config)

    ctx.inject(['chatluna_group_analysis'], (ctx) => {
        ctx.effect(() => scheduleAutoAnalysis(ctx, config))
    })

    modelSchema(ctx)
}

function scheduleAutoAnalysis(ctx: Context, config: GroupAnalysisConfig) {
    if (!config.cronSchedule || !config.cronSchedule.trim()) return () => {}

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
