import { Context } from 'koishi'

import { AnalysisService } from './service/analysis'
import { LLMService } from './service/llm'
import { RendererService } from './service/renderer'
import { MessageService } from './service/message'
import * as commands from './commands'
import type {} from 'koishi-plugin-puppeteer'
import type {} from 'koishi-plugin-cron'
import { Config } from './config'
import { modelSchema } from 'koishi-plugin-chatluna/utils/schema'

export * from './config'
export * from './service/message'

export function apply(ctx: Context, config: Config) {
    ctx.plugin(MessageService, config)
    ctx.plugin(AnalysisService, config)
    ctx.plugin(LLMService, config)
    ctx.plugin(RendererService, config)
    ctx.plugin(commands)

    ctx.inject(['scheduler'], (ctx) => {
        if (!config.cronSchedule && !ctx.cron) {
            return
        }
        ctx.effect(() =>
            ctx.cron(config.cronSchedule, async () => {
                await ctx.analysis.executeAutoAnalysisForEnabledGroups()
            })
        )
    })

    modelSchema(ctx)
}
