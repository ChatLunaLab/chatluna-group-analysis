import { Context } from 'koishi'
import { Config } from '.'
import * as command from './plugins/command'
import * as tool from './plugins/tool'

export function plugin(ctx: Context, config: Config) {
    ctx.plugin(command, config)
    ctx.plugin(tool, config)
}
