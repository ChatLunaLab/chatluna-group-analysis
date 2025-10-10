import { Context } from 'koishi'
import { Config } from '.'
import * as command from './plugins/command'
import * as tool from './plugins/tool'
import * as promptVariable from './plugins/prompt_variable'

export function plugin(ctx: Context, config: Config) {
    ctx.plugin(command, config)
    ctx.plugin(tool, config)
    ctx.plugin(promptVariable, config)
}
