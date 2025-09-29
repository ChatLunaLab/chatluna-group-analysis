import { Context, h, Service } from 'koishi'
import {
    GoldenQuote,
    GroupAnalysisResult,
    SummaryTopic,
    UserTitle
} from '../types'
import { Config, StoredMessage } from '..'
import {
    calculateBasicStats,
    generateActiveHoursChart,
    generateTextReport
} from '../utils'

export class AnalysisService extends Service {
    static readonly inject = [
        'chatluna_group_analysis_llm',
        'chatluna_group_analysis_message',
        'chatluna_group_analysis_renderer'
    ]

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis', true)
    }

    private async _getGroupHistoryFromMessageService(
        selfId: string,
        guildId: string,
        days: number
    ): Promise<StoredMessage[]> {
        const logger = this.ctx.logger('AnalysisService:MessageService')
        logger.info(
            `开始从消息服务获取群组 ${guildId} 近 ${days} 天的消息记录...`
        )

        const startTime = new Date()
        startTime.setDate(startTime.getDate() - days)
        startTime.setHours(0, 0, 0, 0)

        const endTime = new Date()

        const messages =
            await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                {
                    guildId,
                    startTime,
                    selfId,
                    endTime,
                    limit: this.config.maxMessages
                }
            )

        logger.info(`从消息服务获取到 ${messages.length} 条消息。`)
        return messages
    }

    public async executeGroupAnalysis(
        selfId: string,
        guildId: string,
        days: number,
        outputFormat?: 'image' | 'pdf' | 'text'
    ) {
        const bot = this._getBot(selfId)

        await bot?.sendMessage(
            guildId,
            `🔍 开始分析群聊近 ${days} 天的活动，请稍候...`
        )

        let message: h

        try {
            const messages = await this._getGroupHistoryFromMessageService(
                selfId,
                guildId,
                days
            )

            if (messages.length < this.config.minMessages) {
                await bot?.sendMessage(
                    guildId,
                    `消息数量不足（${messages.length}/${this.config.minMessages}）于进行进行有效分析。`
                )
                return
            }

            await bot?.sendMessage(
                guildId,
                `已获取 ${messages.length} 条消息，正在进行智能分析...`
            )

            const analysisResult = await this.analyzeGroupMessages(
                messages,
                guildId
            )

            this.ctx.logger.error(
                'Analysis result:',
                JSON.stringify(analysisResult, null, 2)
            )

            const format = outputFormat || this.config.outputFormat || 'image'

            switch (format) {
                case 'image':
                    {
                        const image =
                            await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysis(
                                analysisResult
                            )
                        message =
                            typeof image === 'string'
                                ? h.text(message)
                                : h.image(image, 'image/png')
                    }
                    break
                case 'pdf': {
                    const pdfBuffer =
                        await this.ctx.chatluna_group_analysis_renderer.renderGroupAnalysisToPdf(
                            analysisResult
                        )
                    message = pdfBuffer
                        ? h.file(pdfBuffer, 'application/pdf')
                        : h.text('PDF 渲染失败，请检查日志。')
                    break
                }
                default: {
                    message = h.text(generateTextReport(analysisResult))
                }
            }
        } catch (error) {
            this.ctx.logger.error(
                `为群组 ${guildId} 执行分析任务时发生错误:`,
                error
            )
            const errorMessage =
                error instanceof Error ? error.message : '未知错误。'

            message = h.text(
                `分析失败: ${errorMessage}。请检查网络连接和 LLM 配置，或联系管理员。`
            )
        }

        await bot.sendMessage(guildId, message)
    }

    public async executeAutoAnalysisForEnabledGroups() {
        const enabledGroups = this.config.listenerGroups
        for (const group of enabledGroups) {
            try {
                await this.executeGroupAnalysis(
                    group.selfId,
                    group.guildId,
                    this.config.cronAnalysisDays
                )
            } catch (err) {
                this.ctx.logger.error(`群 ${group.guildId} 自动分析失败:`, err)
            }
        }
    }

    public async analyzeGroupMessages(
        messages: StoredMessage[],
        guildId: string
    ): Promise<GroupAnalysisResult> {
        this.ctx.logger.info(`开始分析 ${messages.length} 条消息...`)

        const { userStats, totalChars, totalEmojiCount, allMessagesText } =
            calculateBasicStats(messages)

        const messagesText = allMessagesText.join('\n')

        // LLM analyses in parallel
        const users = Object.values(userStats)

        const [topics, userTitles, goldenQuotes] = await Promise.all([
            this.ctx.chatluna_group_analysis_llm.summarizeTopics(messagesText),
            this.config.userTitleAnalysis
                ? this.ctx.chatluna_group_analysis_llm.analyzeUserTitles(users)
                : Promise.resolve([]),
            this.ctx.chatluna_group_analysis_llm.analyzeGoldenQuotes(
                messagesText,
                this.config.maxGoldenQuotes
            )
        ]).catch((error) => {
            this.ctx.logger.error('LLM analysis failed:', error)
            //  On LLM failure, return empty results to avoid crashing the entire analysis.
            return [
                [] as SummaryTopic[],
                [] as UserTitle[],
                [] as GoldenQuote[]
            ] as const
        })

        // Final statistics
        const sortedUsers = users.sort(
            (a, b) => b.messageCount - a.messageCount
        )
        const overallActiveHours = users.reduce(
            (acc, user) => {
                for (const hour in user.activeHours) {
                    acc[hour] = (acc[hour] || 0) + user.activeHours[hour]
                }
                return acc
            },
            {} as Record<number, number>
        )
        const mostActiveHourEntry = Object.entries(overallActiveHours).sort(
            (a, b) => b[1] - a[1]
        )[0]
        const mostActiveHour = mostActiveHourEntry
            ? mostActiveHourEntry[0]
            : 'N/A'

        // Generate chart using the renderer service
        const activeHoursChartHtml =
            generateActiveHoursChart(overallActiveHours)

        const bot = this.ctx.bots.find((b) => b.platform === 'onebot')
        let groupName = guildId
        if (bot) {
            try {
                groupName = (await bot.getGuild(guildId)).name || guildId
            } catch (err) {
                this.ctx
                    .logger('AnalysisService')
                    .warn(`获取群组 ${guildId} 名称失败: ${err}`)
            }
        }

        const result: GroupAnalysisResult = {
            totalMessages: messages.length,
            totalChars,
            totalParticipants: users.length,
            emojiCount: totalEmojiCount,
            mostActiveUser: sortedUsers[0] || null,
            mostActivePeriod:
                mostActiveHour !== 'N/A'
                    ? `${mostActiveHour.padStart(2, '0')}:00 - ${String(parseInt(mostActiveHour) + 1).padStart(2, '0')}:00`
                    : 'N/A',
            userStats: sortedUsers.slice(0, this.config.maxUsersInReport),
            topics,
            userTitles,
            goldenQuotes,
            activeHoursChart: activeHoursChartHtml,
            activeHoursData: overallActiveHours,
            analysisDate: new Date().toLocaleDateString('zh-CN'),
            groupName
        }

        this.ctx.logger.info('消息分析完成。')
        return result
    }

    private _getBot(selfId: string) {
        return this.ctx.bots.find((bot) => bot.selfId === selfId)
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis: AnalysisService
    }
}
