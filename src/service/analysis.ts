import { Context, h, Service, Session } from 'koishi'
import { Config } from '../config'
import {
    AnalysisPromptContext,
    GroupAnalysisResult,
    QueryIntent,
    StoredMessage
} from '../types'
import {
    buildGroupAnalysisCacheKey,
    calculateBasicStats,
    generateTextReport,
    getStartTimeByDays,
    isCacheExpired
} from '../utils'

interface AnalysisTarget {
    guildId?: string
    channelId?: string
}

export class AnalysisService extends Service {
    static readonly inject = [
        'chatluna_group_analysis_llm',
        'chatluna_group_analysis_message',
        'chatluna_group_analysis_renderer',
        'chatluna_group_analysis_persona'
    ]

    private cache = new Map<
        string,
        { result: GroupAnalysisResult; analyzedAt: Date }
    >()

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis', true)
    }

    getUserPersona(platform: string, selfId: string, userId: string) {
        return this.ctx.chatluna_group_analysis_persona.getUserPersona(
            platform,
            selfId,
            userId
        )
    }

    executeUserPersonaAnalysis(
        session: Session,
        userId: string,
        force = false
    ) {
        return this.ctx.chatluna_group_analysis_persona.executeUserPersonaAnalysis(
            session,
            userId,
            force
        )
    }

    async executeGroupAnalysis(
        selfId: string,
        target: AnalysisTarget,
        days: number,
        outputFormat?: 'image' | 'pdf' | 'text',
        force = false
    ) {
        const targetChannel = target.channelId || target.guildId
        const bot = this.ctx.bots.find((item) => item.selfId === selfId)
        if (!targetChannel || !bot) {
            this.ctx.logger.warn('执行群分析需要有效的机器人和频道。')
            return
        }

        const guildId =
            target.channelId && target.guildId ? target.guildId : undefined
        const send = (content: string | h) =>
            bot.sendMessage(targetChannel, content, guildId)

        try {
            const cacheKey = buildGroupAnalysisCacheKey(selfId, target, days)
            const cached = this.cache.get(cacheKey)
            let result: GroupAnalysisResult

            if (
                !force &&
                cached &&
                !isCacheExpired(
                    cached.analyzedAt,
                    this.config.groupAnalysisCacheMinutes * 60 * 1000
                )
            ) {
                result = cached.result
            } else {
                await send(`开始分析群聊近 ${days} 天的活动，请稍候...`)
                const messages = await this.getGroupHistory(
                    selfId,
                    target,
                    getStartTimeByDays(days, this.config.useCalendarDayWindow),
                    new Date()
                )
                if (messages.length < this.config.minMessages) {
                    await send(
                        `消息数量（${messages.length}/${this.config.minMessages}）不足，无法进行有效分析。`
                    )
                    return
                }

                result = await this.analyzeGroupMessages(
                    messages,
                    selfId,
                    target
                )
                if (this.cache.size >= 100) {
                    const oldest = this.cache.keys().next().value
                    if (oldest) this.cache.delete(oldest)
                }
                this.cache.set(cacheKey, { result, analyzedAt: new Date() })
            }

            await send(
                await this.createReportMessage(
                    result,
                    outputFormat || this.config.outputFormat
                )
            )
        } catch (error) {
            this.ctx.logger.error(
                `为群组 ${target.guildId || target.channelId} 执行分析失败:`,
                error
            )
            const reason = error instanceof Error ? error.message : '未知错误。'
            await send(
                `分析失败: ${reason}。请检查网络连接和 LLM 配置，或联系管理员。`
            )
        }
    }

    async executeGroupQuery(
        session: Session,
        target: AnalysisTarget,
        query: string,
        outputFormat?: 'image' | 'pdf' | 'text'
    ) {
        const targetChannel = target.channelId || target.guildId
        const bot = this.ctx.bots.find((item) => item.selfId === session.selfId)
        if (!targetChannel || !bot) {
            this.ctx.logger.warn('执行群分析需要有效的机器人和频道。')
            return
        }

        const guildId =
            target.channelId && target.guildId ? target.guildId : undefined
        const send = (content: string | h) =>
            bot.sendMessage(targetChannel, content, guildId)

        try {
            const currentTime = new Date()
            const groupName = await this.resolveGroupName(
                session.selfId,
                target
            )
            const intent =
                await this.ctx.chatluna_group_analysis_llm.parseGroupQuery({
                    query,
                    currentTime: currentTime.toLocaleString('zh-CN', {
                        hour12: false
                    }),
                    timeZone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone ||
                        'UTC',
                    platform: session.platform,
                    groupName,
                    guildId: target.guildId,
                    channelId: target.channelId,
                    currentUserId: session.userId,
                    currentUserName: session.username || session.userId
                })
            if (!intent) {
                await send('未能解析你的请求，请换个说法再试。')
                return
            }

            const timeRange = this.getQueryTimeRange(intent)
            const messages = await this.getGroupHistory(
                session.selfId,
                target,
                timeRange.start,
                timeRange.end
            )
            if (messages.length < this.config.minMessages) {
                await send(
                    `消息数量（${messages.length}/${this.config.minMessages}）不足，无法进行有效分析。`
                )
                return
            }

            const context: AnalysisPromptContext = {
                keywords: intent.keywords || [],
                topics: intent.topics || [],
                nicknames: intent.nicknames || [],
                query,
                timeRange
            }
            const result = await this.analyzeGroupMessages(
                messages,
                session.selfId,
                target,
                context
            )
            const textReport = generateTextReport(result)
            const action =
                intent.action === '分析加对话' || intent.action === '只对话'
                    ? intent.action
                    : '只分析'

            if (action !== '只对话') {
                await send(
                    await this.createReportMessage(
                        result,
                        outputFormat || this.config.outputFormat
                    )
                )
            }

            if (action !== '只分析') {
                const reply =
                    await this.ctx.chatluna_group_analysis_llm.replyGroupQuery({
                        query,
                        analysisResult: textReport,
                        currentTime: currentTime.toLocaleString('zh-CN', {
                            hour12: false
                        }),
                        groupName,
                        guildId: target.guildId,
                        channelId: target.channelId,
                        currentUserId: session.userId,
                        currentUserName: session.username || session.userId
                    })
                await send(reply || '对话生成失败，请稍后再试。')
            }
        } catch (error) {
            this.ctx.logger.error('执行群分析查询失败:', error)
            const reason = error instanceof Error ? error.message : '未知错误。'
            await send(
                `分析失败: ${reason}。请检查网络连接和 LLM 配置，或联系管理员。`
            )
        }
    }

    async executeAutoAnalysisForEnabledGroups() {
        const groups = this.config.listenerGroups.filter(
            (group) => group.enabled
        )
        for (let index = 0; index < groups.length; index += 3) {
            await Promise.allSettled(
                groups.slice(index, index + 3).map(async (group) => {
                    try {
                        await this.executeGroupAnalysis(
                            group.selfId,
                            group,
                            this.config.cronAnalysisDays
                        )
                    } catch (error) {
                        this.ctx.logger.error(
                            `群 ${group.guildId || group.channelId} 自动分析失败:`,
                            error
                        )
                    }
                })
            )
        }
    }

    async analyzeGroupMessages(
        messages: StoredMessage[],
        selfId: string,
        target: AnalysisTarget,
        context: AnalysisPromptContext = {}
    ): Promise<GroupAnalysisResult> {
        const { userStats, totalChars, totalEmojiCount, allMessagesText } =
            calculateBasicStats(messages)
        const messagesText = allMessagesText.join('\n')
        const users = Object.values(userStats)
        const llm = this.ctx.chatluna_group_analysis_llm
        const results = await Promise.allSettled([
            llm.summarizeTopics(messagesText, context),
            this.config.userTitleAnalysis
                ? llm.analyzeUserTitles(users, context)
                : Promise.resolve([]),
            llm.analyzeGoldenQuotes(
                messagesText,
                this.config.maxGoldenQuotes,
                context
            )
        ])

        const llmResults = this.config.userTitleAnalysis
            ? results
            : [results[0], results[2]]
        const errors: unknown[] = []
        for (const result of llmResults) {
            if (result.status === 'fulfilled') continue
            errors.push(result.reason)
            this.ctx.logger.warn('部分 LLM 分析失败:', result.reason)
        }
        if (errors.length === llmResults.length) throw errors[0]
        const [topicsResult, titlesResult, quotesResult] = results
        const topics =
            topicsResult.status === 'fulfilled' ? topicsResult.value : []
        const userTitles =
            titlesResult.status === 'fulfilled' ? titlesResult.value : []
        const goldenQuotes =
            quotesResult.status === 'fulfilled' ? quotesResult.value : []

        const sortedUsers = users.sort(
            (a, b) => b.messageCount - a.messageCount
        )
        const activeHours: Record<number, number> = {}
        for (const user of users) {
            for (const hour in user.activeHours) {
                activeHours[hour] =
                    (activeHours[hour] || 0) + user.activeHours[hour]
            }
        }

        const mostActive = Object.entries(activeHours).sort(
            (a, b) => b[1] - a[1]
        )[0]
        let mostActivePeriod = 'N/A'
        if (mostActive) {
            const hour = Number(mostActive[0])
            mostActivePeriod = `${String(hour).padStart(2, '0')}:00 - ${String(hour + 1).padStart(2, '0')}:00`
        }

        return {
            totalMessages: messages.length,
            totalChars,
            totalParticipants: users.length,
            emojiCount: totalEmojiCount,
            mostActiveUser: sortedUsers[0] || null,
            mostActivePeriod,
            userStats: sortedUsers.slice(0, this.config.maxUsersInReport),
            topics,
            userTitles,
            goldenQuotes,
            activeHoursData: activeHours,
            analysisDate: new Date().toLocaleDateString('zh-CN'),
            groupName: await this.resolveGroupName(selfId, target)
        }
    }

    private getGroupHistory(
        selfId: string,
        target: AnalysisTarget,
        startTime: Date,
        endTime: Date
    ) {
        return this.ctx.chatluna_group_analysis_message.getHistoricalMessages({
            guildId: target.guildId,
            channelId: target.channelId,
            startTime,
            endTime,
            selfId,
            limit: this.config.maxMessages,
            purpose: 'group-analysis'
        })
    }

    private getQueryTimeRange(intent: QueryIntent) {
        const now = new Date()
        const target = intent.targetTime
        let start =
            target && target.startTime ? new Date(target.startTime) : undefined
        let end = target && target.endTime ? new Date(target.endTime) : now

        if (!start || isNaN(start.getTime())) {
            start = getStartTimeByDays(
                this.config.cronAnalysisDays || 1,
                this.config.useCalendarDayWindow
            )
        }
        if (isNaN(end.getTime())) end = now
        if (start > end) [start, end] = [end, start]

        return { start, end, description: target && target.description }
    }

    private async resolveGroupName(selfId: string, target: AnalysisTarget) {
        const fallback = target.guildId || target.channelId || 'unknown'
        const bot = this.ctx.bots.find((item) => item.selfId === selfId)
        if (!bot) return fallback

        try {
            if (target.guildId) {
                const guild = await bot.getGuild(target.guildId)
                return guild.name || fallback
            }
            if (target.channelId && bot.getChannel) {
                const channel = await bot.getChannel(
                    target.channelId,
                    target.guildId
                )
                return channel && channel.name ? channel.name : fallback
            }
        } catch (error) {
            this.ctx.logger.warn(`获取群组 ${fallback} 名称失败: ${error}`)
        }
        return fallback
    }

    private async createReportMessage(
        result: GroupAnalysisResult,
        format: 'image' | 'pdf' | 'text'
    ): Promise<h> {
        if (format === 'text') return h.text(generateTextReport(result))
        if (format === 'pdf') {
            const pdf =
                await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysisToPdf(
                    result
                )
            return pdf
                ? h.file(pdf, 'application/pdf')
                : h.text('PDF 渲染失败，请检查日志。')
        }

        const image =
            await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysis(
                result,
                this.config
            )
        return typeof image === 'string'
            ? h.text(image)
            : h.image(image, 'image/png')
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis: AnalysisService
    }
}
