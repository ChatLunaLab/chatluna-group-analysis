/* eslint-disable max-len */
import { Context, Session } from 'koishi'
import { AnalysisService } from './service/analysis'
import { RendererService } from './service/renderer'
import { Config } from './config'

export const name = 'group-analysis-commands'

declare module 'koishi' {
    interface Context {
        analysis: AnalysisService
        renderer: RendererService
    }
}

export const inject = {
    chatluna_group_analysis: {
        required: true
    }
}

export function apply(ctx: Context, config: Config) {

    const checkGroup = (session: Session) => {
        return (
            config.listenerGroups.some(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            ) &&
            config.listenerGroups.some(
                (settings) =>
                    settings.enabled &&
                    (settings.channelId === session.channelId && session.channelId != null)
            )
        )
    }

    const settings = ctx
        .command('群分析 [days:number]', '分析本群的近期聊天记录')
        .usage(
            '本功能会分析本群的近期聊天记录，并生成一份报告。\n' +
                '默认情况下，本功能会分析最近 1 天的聊天记录。\n' +
                '你可以通过指定天数参数来调整分析的时长。\n' +
                '例如：/群分析 7'
        )
        .alias('group-analysis')
        .action(async ({ session }, days) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            if (!checkGroup(session))
                return '本群未启用分析功能，请使用 群分析.启用 来启用本群的分析功能。'

            const analysisDays = days || ctx.config?.cronAnalysisDays || 1
            if (analysisDays > 7)
                return '出于性能考虑，最多只能分析 7 天的数据。'

            try {
                await ctx.chatluna_group_analysis.executeGroupAnalysis(
                    session.selfId,
                    session.guildId,
                    analysisDays
                )
            } catch (err) {
                ctx.logger.error('执行分析时发生未捕获的错误:', err)
                return '群分析执行失败，请检查日志。'
            }
        })

    settings
        .subcommand('.enable', '启用本群的分析功能')
        .alias('.启用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.find(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            if (originalGroupSetting) {
                originalGroupSetting.enabled = true
            } else {
                config.listenerGroups.push({
                    guildId: session.guildId,
                    channelId: session.channelId,
                    selfId: session.selfId,
                    enabled: true,
                    platform: session.platform
                })
            }

            ctx.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 启用日常分析功能。`
        })

    settings
        .subcommand('.disable', '禁用本群的分析功能')
        .alias('.禁用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.findIndex(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            if (originalGroupSetting !== -1) {
                config.listenerGroups.splice(originalGroupSetting, 1)
            }

            ctx.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 禁用日常分析功能。`
        })

    settings
        .subcommand('.status', '查看当前分析设置')
        .alias('.状态')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const config = ctx.config as Config

            const originalGroupSetting = config.listenerGroups.find(
                (settings) =>
                    (settings.channelId === session.channelId &&
                        session.channelId != null) ||
                    (settings.guildId !== null &&
                        settings.guildId === session.guildId)
            )

            ctx.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            const enabled = originalGroupSetting?.enabled ? '已启用' : '未启用'
            return `当前群 ${guildName} (${guildId}) 分析功能状态: ${enabled}`
        })

    settings
        .subcommand('.用户画像 [user:user]', '查看指定用户的画像')
        .alias('.persona')
        .usage(
            '使用方法：/群分析.用户画像 @用户 或 /群分析.用户画像 <用户ID> 或 /群分析.用户画像。不带 参数时查看当前用户。'
        )
        .option('force', '-f 是否强制更新用户画像')
        .action(async ({ session, options }, user) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

             if (!checkGroup(session))
                return '本群未启用群分析功能，请使用 群分析.启用 来启用本群的群分析功能。'

            const userId = user?.split(':')[1] ?? session.userId
           
            if (!userId) {
                return '无法获取目标用户信息。'
            }

            try {
                await ctx.chatluna_group_analysis.executeUserPersonaAnalysis(
                    session,
                    userId,
                    options.force ?? false
                )
            } catch (err) {
                ctx.logger.error(
                    `执行用户画像分析时发生未捕获的错误 (用户: ${userId}):`,
                    err
                )
                return '用户画像分析执行失败，请检查日志。'
            }
        })
}
