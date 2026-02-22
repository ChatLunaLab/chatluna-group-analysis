import { Context } from 'koishi'

import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { RendererService } from './service/renderer'
import { MessageService } from './service/message'
import { plugin } from './plugin'
import type {} from 'koishi-plugin-puppeteer'
import type {} from 'koishi-plugin-cron'
import { Config } from './config'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'

export * from './config'
export * from './service/message'

export function apply(ctx: Context, config: Config) {
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

    ctx.inject(['cron'], (ctx) => {
        if (!config.cronSchedule || !ctx.cron) {
            return
        }
        ctx.effect(() =>
            ctx.cron(config.cronSchedule, async () => {
                await ctx.chatluna_group_analysis.executeAutoAnalysisForEnabledGroups()
            })
        )
    })

    modelSchema(ctx)
}
