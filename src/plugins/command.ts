import { Context, Session, User } from 'koishi'
import { Config } from '../config'
import { shouldListenToMessage } from '../utils/message'

export const inject = {
    chatluna_group_analysis: { required: true }
}

export function apply(ctx: Context, config: Config) {
    const appContext = ctx.scope.parent
    const checkGroup = (
        session: Session,
        target?: { guildId?: string; channelId?: string }
    ) => {
        const scope = target || session
        return shouldListenToMessage(
            {
                guildId: scope.guildId,
                channelId: scope.channelId,
                platform: session.platform,
                selfId: session.selfId
            },
            config.listenerGroups,
            config.enableAllGroupsByDefault
        )
    }

    const findListener = (session: Session) =>
        config.listenerGroups.find(
            (listener) =>
                listener.platform === session.platform &&
                listener.selfId === session.selfId &&
                ((listener.channelId &&
                    listener.channelId === session.channelId) ||
                    (listener.guildId && listener.guildId === session.guildId))
        )

    const getGuildName = async (session: Session) => {
        const guildId = session.event.guild.id
        try {
            const guild = await session.bot.getGuild(guildId)
            return guild.name || session.event.guild.name || guildId
        } catch {
            return session.event.guild.name || guildId
        }
    }

    const settings = ctx
        .command('群分析 [query:text]', '分析本群的近期聊天记录')
        .usage(
            '本功能会分析本群的近期聊天记录，并生成一份报告。\n' +
                '默认分析最近 1 天，也可以直接输入自然语言进行查询和对话。\n' +
                '例如：/群分析 告诉我最近三小时都聊了什么'
        )
        .alias('group-analysis')
        .option('force', '-f 是否强制刷新群分析')
        .option('group', '-g <guildId:string> 指定群号', { authority: 3 })
        .option('channel', '-c <channelId:string> 指定频道号', { authority: 3 })
        .action(async ({ session, options }, query) => {
            if (session.isDirect && !options.group && !options.channel) {
                return '私聊中请使用 -g 或 -c 指定目标群或频道。'
            }

            const explicit = options.group || options.channel
            const guildId =
                options.group || (explicit ? undefined : session.guildId)
            const channelId =
                options.channel || (explicit ? undefined : session.channelId)
            if (!guildId && !channelId)
                return '请使用 -g 或 -c 指定目标群或频道。'
            if (!checkGroup(session, { guildId, channelId })) {
                return '目标群未启用分析功能，请使用 群分析.启用 来启用目标群的分析功能。'
            }

            try {
                if (query && query.trim()) {
                    await ctx.chatluna_group_analysis.executeGroupQuery(
                        session,
                        { guildId, channelId },
                        query.trim()
                    )
                    return
                }

                const days = config.cronAnalysisDays || 1
                if (days > 7) return '出于性能考虑，最多只能分析 7 天的数据。'
                await ctx.chatluna_group_analysis.executeGroupAnalysis(
                    session.selfId,
                    { guildId, channelId },
                    days,
                    undefined,
                    !!options.force
                )
            } catch (error) {
                ctx.logger.error('执行分析时发生未捕获的错误:', error)
                return '群分析执行失败，请检查日志。'
            }
        })

    settings
        .subcommand('.enable', '启用本群的分析功能', { authority: 3 })
        .alias('.启用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'
            if (config.enableAllGroupsByDefault)
                return '已开启全群默认启用，无需单独启用。'

            const original = findListener(session)
            if (original) {
                original.enabled = true
            } else {
                config.listenerGroups.push({
                    guildId: session.guildId,
                    channelId: session.channelId,
                    selfId: session.selfId,
                    enabled: true,
                    platform: session.platform
                })
            }

            await appContext.scope.update(appContext.config, true)
            return `已为当前群 ${await getGuildName(session)} (${session.event.guild.id}) 启用日常分析功能。`
        })

    settings
        .subcommand('.disable', '禁用本群的分析功能', { authority: 3 })
        .alias('.禁用')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'
            if (config.enableAllGroupsByDefault)
                return '当前为全群默认启用模式，请先在配置中关闭该模式。'

            const original = findListener(session)
            if (!original) return '当前群没有单独的分析监听配置。'
            config.listenerGroups.splice(
                config.listenerGroups.indexOf(original),
                1
            )
            await appContext.scope.update(appContext.config, true)
            return `已为当前群 ${await getGuildName(session)} (${session.event.guild.id}) 禁用日常分析功能。`
        })

    settings
        .subcommand('clear', '清理当前群分析缓存', { authority: 3 })
        .alias('.清理')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'
            await ctx.database.remove('chatluna_messages', {
                platform: session.platform,
                selfId: session.selfId,
                guildId: session.guildId,
                channelId: session.channelId || session.guildId
            })
            return `已清理当前群 ${await getGuildName(session)} (${session.event.guild.id}) 的分析缓存。`
        })

    settings
        .subcommand('.status', '查看当前分析设置')
        .alias('.状态')
        .action(async ({ session }) => {
            if (session.isDirect) return '请在群聊中使用此命令。'
            const original = findListener(session)
            const enabled =
                config.enableAllGroupsByDefault ||
                (original && original.enabled)
            const status = enabled ? '已启用' : '未启用'
            return `当前群 ${await getGuildName(session)} (${session.event.guild.id}) 分析功能状态: ${status}`
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

            let userId = session.userId
            if (user) {
                const parts = user.split(':')
                userId = parts[1] || parts[0]
            }
            if (!userId) return '无法获取目标用户信息。'

            const currentUser = (session as Session<User.Field>).user
            const authority = currentUser ? currentUser.authority : 0
            if (userId !== session.userId && authority < 3) {
                await session.send(
                    '你没有权限查看其他用户的画像。当前需要的权限为 3 级。将转为查看自己的画像。'
                )
                userId = session.userId
            }
            if (config.personaUserFilter.includes(userId))
                return '该用户已被设置为禁止分析用户画像。'

            try {
                await ctx.chatluna_group_analysis.executeUserPersonaAnalysis(
                    session,
                    userId,
                    !!options.force
                )
            } catch (error) {
                ctx.logger.error(
                    `执行用户画像分析时发生未捕获的错误 (用户: ${userId}):`,
                    error
                )
                return '用户画像分析执行失败，请检查日志。'
            }
        })
}
