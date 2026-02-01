/* eslint-disable max-len */
import { Context, Session } from 'koishi'
import { Config } from '../config'
import { shouldListenToMessage } from '../utils'

export const inject = {
    chatluna_group_analysis: {
        required: true
    }
}

export function apply(ctx: Context, config: Config) {
    const checkGroup = (session: Session) => {
        if (config.enableAllGroupsByDefault) return true
        if (!config.listenerGroups) return false
        return shouldListenToMessage(
            {
                guildId: session.guildId || undefined,
                channelId: session.channelId || undefined,
                platform: session.platform,
                selfId: session.selfId
            },
            config.listenerGroups
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
        .option('force', '-f 是否强制刷新群分析')
        .action(async ({ session, options }, days) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            if (!checkGroup(session))
                return '本群未启用分析功能，请使用 群分析.启用 来启用本群的分析功能。'

            const analysisDays = days || ctx.config?.cronAnalysisDays || 1
            if (analysisDays > 7)
                return '出于性能考虑，最多只能分析 7 天的数据。'

            try {
                await ctx.chatluna_group_analysis.executeGroupAnalysis(
                    session.selfId,
                    {
                        guildId: session.guildId || undefined,
                        channelId: session.channelId || undefined
                    },
                    analysisDays,
                    undefined,
                    options.force ?? false
                )
            } catch (err) {
                ctx.logger.error('执行分析时发生未捕获的错误:', err)
                return '群分析执行失败，请检查日志。'
            }
        })

    settings
        .subcommand('.enable', '启用本群的分析功能', {
            authority: 3
        })
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

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 启用日常分析功能。`
        })

    settings
        .subcommand('.disable', '禁用本群的分析功能', {
            authority: 3
        })
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

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            return `已为当前群 ${guildName} (${guildId}) 禁用日常分析功能。`
        })

    settings
        .subcommand('clear', '清理当前群分析的某些缓存')
        .alias('.清理')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            ctx.database.remove('chatluna_messages', {
                guildId: session.guildId,
                channelId: session.channelId || session.guildId
            })

            return `已清理当前群 ${guildName} (${guildId}) 的分析缓存。`
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

            ctx.scope.parent.scope.parent.scope.update(config, true)

            const guildId = session.event.guild.id

            const guildName =
                (await session.bot
                    .getGuild(guildId)
                    .then((guild) => guild.name)) || session.event.guild.name

            const enabled = originalGroupSetting?.enabled ? '已启用' : '未启用'
            return `当前群 ${guildName} (${guildId}) 分析功能状态: ${enabled}`
        })

    ctx.command('用户画像 [user:user]', '查看指定用户的画像')
        .alias('group-analysis.persona')
        .alias('群分析.用户画像')
        .usage(
            '使用方法：/群分析.用户画像 @用户 或 /群分析.用户画像 <用户ID> 或 /群分析.用户画像。不带参数时查看当前用户。查看其他用户需要为 bot 管理员。'
        )
        .option('force', '-f 是否强制更新用户画像')
        .action(async ({ session, options }, user) => {
            if (session.isDirect) return '请在群聊中使用此命令。'

            if (!checkGroup(session))
                return '本群未启用群分析功能，请使用 群分析.启用 来启用本群的群分析功能。'

            let userId = user?.split(':')?.[1] ?? session.userId

            if (
                userId !== session.userId &&
                !(await ctx.permissions.check('authority:3', session))
            ) {
                await session.send(
                    '你没有权限查看其他用户的画像。当前需要的权限为 3 级。将转为查看自己的画像。'
                )
                userId = session.userId
            }

            if (!userId) {
                return '无法获取目标用户信息。'
            }

            if (config.personaUserFilter.includes(userId)) {
                return '该用户已被设置为禁止分析用户画像。'
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
