import { Context } from 'koishi'
import { Config } from '.'
import * as command from './plugins/command'

export function plugin(ctx: Context, config: Config) {
    ctx.plugin(command)
}
