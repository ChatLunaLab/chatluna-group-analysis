import { Context, h, Service, Session } from 'koishi'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import {
    GoldenQuote,
    GroupAnalysisResult,
    SummaryTopic,
    UserTitle,
    UserPersonaProfile
} from '../types'
import { Config, StoredMessage } from '..'
import {
    calculateBasicStats,
    generateActiveHoursChart,
    generateTextReport,
    getAvatarUrl,
    getStartTimeByDays,
    mergePersona,
    normalizePersonaText,
    shouldListenToMessage
} from '../utils'
import { writeFile } from 'fs/promises'
import type { GuildMember } from '@satorijs/protocol'

interface PersonaRecord {
    id: string
    platform: string
    selfId: string
    userId: string
    username: string
    persona?: string
    lastAnalysisAt?: Date
    updatedAt?: Date
}

interface PersonaCache {
    record: PersonaRecord
    pendingMessages: number
    parsedPersona?: UserPersonaProfile | null
}

export class AnalysisService extends Service {
    static readonly inject = [
        'chatluna_group_analysis_llm',
        'chatluna_group_analysis_message',
        'chatluna_group_analysis_renderer'
    ]

    private personaCache = new Map<string, PersonaCache>()
    private personaProcessing = new Set<string>()

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis', true)
        this.setupPersonaDatabase()
        this.setupPersonaMessageListener()
    }

    private setupPersonaDatabase() {
        this.ctx.database.extend(
            'chatluna_user_personas',
            {
                id: {
                    type: 'char',
                    length: 100
                },
                platform: {
                    type: 'char',
                    length: 30
                },
                selfId: { type: 'char', length: 100 },
                userId: { type: 'char', length: 100 },
                username: { type: 'char', length: 254 },
                persona: { type: 'text', nullable: true },
                lastAnalysisAt: { type: 'timestamp', nullable: true },
                updatedAt: { type: 'timestamp', nullable: true }
            },
            {
                primary: 'id'
            }
        )
    }

    private setupPersonaMessageListener() {
        if (this.config.personaAnalysisMessageInterval === 0) {
            this.ctx.logger.info(
                '已关闭自动用户画像分析（personaAnalysisMessageInterval = 0）。'
            )
            return
        }

        this.ctx.chatluna_group_analysis_message.onUserMessage(
            async (session) => {
                if (!shouldListenToMessage(session, this.config.listenerGroups))
                    return

                await this.handleIncomingMessageForPersona(session)
            }
        )
    }

    private async handleIncomingMessageForPersona(session: Session) {
        if (this.config.personaAnalysisMessageInterval === 0) return
        if (!session.userId) return
        const recordId = this.getPersonaRecordId(
            session.platform,
            session.selfId,
            session.userId
        )

        const cache = await this.ensurePersonaCache(recordId, {
            platform: session.platform,
            selfId: session.selfId,
            userId: session.userId,
            username: session.username || session.userId
        })

        cache.pendingMessages += 1
        cache.record.username = session.username || cache.record.username

        if (
            cache.pendingMessages >=
                this.config.personaAnalysisMessageInterval &&
            !this.personaProcessing.has(recordId)
        ) {
            this.personaProcessing.add(recordId)
            void this.runPersonaAnalysis(cache)
                .catch((error) =>
                    this.ctx.logger.error(
                        `执行用户画像分析失败 (${recordId}):`,
                        error
                    )
                )
                .finally(() => {
                    this.personaProcessing.delete(recordId)
                    cache.pendingMessages = 0
                })
        }
    }

    private async ensurePersonaCache(
        id: string,
        defaults: Pick<
            PersonaRecord,
            'platform' | 'selfId' | 'userId' | 'username'
        >
    ): Promise<PersonaCache> {
        const cached = this.personaCache.get(id)
        if (cached) return cached

        let existing = await this.ctx.database
            .select('chatluna_user_personas')
            .where({ id })
            .execute()
            .then((records) => records[0])

        if (existing) {
            if (
                existing.lastAnalysisAt &&
                !(existing.lastAnalysisAt instanceof Date)
            ) {
                existing.lastAnalysisAt = new Date(existing.lastAnalysisAt)
            }
            if (existing.updatedAt && !(existing.updatedAt instanceof Date)) {
                existing.updatedAt = new Date(existing.updatedAt)
            }
        }

        let parsedPersona: UserPersonaProfile | null
        if (existing?.persona) {
            try {
                parsedPersona = yamlLoad(existing.persona) as UserPersonaProfile
            } catch (error) {
                this.ctx.logger.warn(
                    `解析用户画像 YAML 失败 (${id})，将忽略历史画像。`,
                    error
                )
                parsedPersona = null
            }
        }

        const cache: PersonaCache = {
            record:
                existing ||
                ({
                    id,
                    ...defaults
                } as PersonaRecord),
            pendingMessages: 0,
            parsedPersona
        }

        /* if (!existing) {
            await this.ctx.database.create(
                'chatluna_user_personas',
                cache.record
            )
        } */

        this.personaCache.set(id, cache)
        return cache
    }

    private getPersonaRecordId(
        platform: string,
        selfId: string,
        userId: string | number
    ) {
        return `${platform}:${selfId}:${userId}`
    }

    private isPersonaCacheExpired(lastAnalysisAt?: Date) {
        const ttlDays = this.config.personaCacheLifetimeDays
        if (ttlDays <= 0) return true
        if (!lastAnalysisAt) return true

        const ttlMs = ttlDays * 24 * 60 * 60 * 1000
        return Date.now() - lastAnalysisAt.getTime() > ttlMs
    }

    private async runPersonaAnalysis(cache: PersonaCache) {
        const { record } = cache
        const lookbackStart = getStartTimeByDays(
            this.config.personaLookbackDays
        )

        const historyMessages = await this.collectUserMessagesForPersona(
            record,
            lookbackStart
        )

        if (historyMessages.length < this.config.personaMinMessages) {
            this.ctx.logger.info(
                `用户 ${record.userId} 在设定时间窗内仅收集到 ${historyMessages.length} 条消息，低于触发阈值 ${this.config.personaMinMessages}，跳过画像分析。`
            )
            return
        }

        const promptMessages = this.formatMessagesForPersona(historyMessages)

        this.ctx.logger.info(
            `开始分析用户 ${record.userId} 的画像 (${record.username})，收集到 ${historyMessages.length} 条消息。`
        )

        const previousText = this.formatPersonaForPrompt(cache.parsedPersona)

        const persona =
            await this.ctx.chatluna_group_analysis_llm.analyzeUserPersona(
                record.userId,
                record.username,
                promptMessages,
                previousText
            )

        if (!persona) {
            this.ctx.logger.warn(`LLM 未返回用户画像结果 (${record.userId})。`)
            return
        }

        const personaWithEvidence = this.attachEvidenceMessageIds(
            persona,
            historyMessages
        )

        const merged = mergePersona(cache.parsedPersona, personaWithEvidence)
        cache.parsedPersona = merged

        await this.persistPersona(record, merged)
    }

    private async collectUserMessagesForPersona(
        record: PersonaRecord,
        startTime: Date
    ): Promise<StoredMessage[]> {
        const results: StoredMessage[] = []
        const relevantGroups = this.config.listenerGroups.filter(
            (group) =>
                group.enabled &&
                group.platform === record.platform &&
                group.selfId === record.selfId
        )

        if (!relevantGroups.length) {
            this.ctx.logger.warn(
                `未在配置中找到用于用户 ${record.userId} 的监听群组，跳过画像分析。`
            )
            return []
        }

        const totalLimit = this.config.personaMaxMessages

        for (const group of relevantGroups) {
            const bot = this._getBot(group.selfId)

            let userGroupInfo: GuildMember | null = null

            try {
                userGroupInfo = await bot.getGuildMember(
                    group.channelId || group.guildId,
                    record.userId
                )
                if (userGroupInfo == null) {
                    continue
                }
            } catch (error) {
                this.ctx.logger.warn(
                    `获取用户 ${record.userId} 的群组信息失败 (${group.channelId || group.guildId})，可能是未加入该群聊。将跳过此群组的信息获取。`,
                    error
                )
                continue
            }

            const history =
                await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    {
                        guildId: group.guildId,
                        channelId: group.channelId,
                        userId: [record.userId],
                        selfId: group.selfId,
                        startTime,
                        endTime: new Date(),
                        limit: totalLimit
                    }
                )

            results.push(
                ...history.map((message) => ({
                    ...message,
                    guildId: message.guildId ?? group.guildId,
                    channelId: message.channelId ?? group.channelId
                }))
            )

            if (results.length >= totalLimit) {
                break
            }
        }

        results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

        if (results.length > totalLimit) {
            return results.slice(-totalLimit)
        }

        return results
    }

    private formatMessagesForPersona(messages: StoredMessage[]): string {
        return messages
            .map((message) => {
                const time = message.timestamp
                    .toISOString()
                    .replace('T', ' ')
                    .slice(0, 16)
                const scope = message.guildId
                    ? `群:${message.guildId}`
                    : `频道:${message.channelId}`
                const normalized = normalizePersonaText(message.content)
                const referenceId = message.messageId || message.id
                const referenceLabel = referenceId
                    ? `msgid:${referenceId}`
                    : `msgid:${message.id}`
                return `[${time}] ${scope} ${message.username} <${referenceLabel}>: ${normalized}`
            })
            .join('\n')
    }

    private formatPersonaForPrompt(
        persona?: UserPersonaProfile | null
    ): string {
        if (!persona) return '（无历史画像）'

        const lines: string[] = []
        lines.push(`summary: ${persona.summary || '无'}`)
        lines.push(`keyTraits: ${(persona.keyTraits || []).join('; ') || '无'}`)
        lines.push(`interests: ${(persona.interests || []).join('; ') || '无'}`)
        lines.push(
            `communicationStyle: ${persona.communicationStyle || '未知'}`
        )
        if (!persona.evidence || !persona.evidence.length) {
            lines.push('evidence: 无')
        } else {
            lines.push('evidence:')
            persona.evidence.forEach((item) => {
                lines.push(`    quote: ${item || '（空）'}`)
            })
        }
        return lines.join('\n')
    }

    private attachEvidenceMessageIds(
        persona: UserPersonaProfile,
        messages: StoredMessage[]
    ): UserPersonaProfile {
        writeFile('./persona.json', JSON.stringify(persona))
        if (!persona.evidence) {
            return persona
        }

        const evidenceEntries = persona.evidence
        const messageIndex: Record<string, StoredMessage> = {}

        for (const message of messages) {
            const key = message.messageId || message.id
            if (key && !messageIndex[key]) {
                messageIndex[key] = message
            }
        }

        const updated: string[] = []

        for (const entry of evidenceEntries) {
            let resolvedMessage: StoredMessage | undefined = messageIndex[entry]

            if (resolvedMessage) {
                updated.push(resolvedMessage.elements.join(''))
            } else {
                this.ctx.logger.warn(
                    `无法找到画像证据 ${entry} 对应的消息，请检查消息服务是否正常。`
                )
            }
        }

        this.ctx.logger.info(`已解析 ${updated.length} 条画像证据。`)

        return {
            ...persona,
            evidence: updated.length ? updated : []
        }
    }

    private async persistPersona(
        record: PersonaRecord,
        persona: UserPersonaProfile
    ) {
        const now = new Date()
        record.persona = yamlDump(persona, {
            indent: 2,
            lineWidth: -1,
            noRefs: true
        })
        record.lastAnalysisAt = now
        record.updatedAt = now

        await this.ctx.database.upsert('chatluna_user_personas', [record])
    }

    private async _getGroupHistoryFromMessageService(
        selfId: string,
        guildId: string,
        days: number
    ): Promise<StoredMessage[]> {
        this.ctx.logger.info(
            `开始从消息服务获取群组 ${guildId} 近 ${days} 天的消息记录...`
        )

        const startTime = getStartTimeByDays(days)

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

        this.ctx.logger.info(`从消息服务获取到 ${messages.length} 条消息。`)
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
            `开始分析群聊近 ${days} 天的活动，请稍候...`
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
                    `消息数量（${messages.length}/${this.config.minMessages}）不足于进行进行有效分析。`
                )
                return
            }

            await bot?.sendMessage(
                guildId,
                `已获取 ${messages.length} 条消息，正在进行智能分析...`
            )

            const analysisResult = await this.analyzeGroupMessages(
                messages,
                selfId,
                guildId
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

    public async getUserPersona(
        platform: string,
        selfId: string,
        userId: string
    ): Promise<{ profile: UserPersonaProfile; username: string } | null> {
        const recordId = this.getPersonaRecordId(platform, selfId, userId)

        // First, check the cache
        const cached = this.personaCache.get(recordId)
        if (cached?.parsedPersona) {
            return {
                profile: cached.parsedPersona,
                username: cached.record.username
            }
        }

        // If not in cache, query the database
        const record = await this.ctx.database
            .select('chatluna_user_personas')
            .where({ id: recordId })
            .execute()
            .then((records) => records[0])

        if (!record?.persona) {
            return null
        }

        try {
            const profile = yamlLoad(record.persona) as UserPersonaProfile
            return { profile, username: record.username }
        } catch (error) {
            this.ctx.logger.warn(
                `解析用户画像 YAML 失败 (${recordId})，无法提供画像。`,
                error
            )
            return null
        }
    }

    public async executeUserPersonaAnalysis(
        session: Session,
        userId: string,
        force?: boolean
    ) {
        const bot = session.bot

        await session.send('正在查询用户画像数据，请稍候...')

        let message: h

        try {
            const recordId = this.getPersonaRecordId(
                session.platform,
                session.selfId,
                userId
            )

            const cache = await this.ensurePersonaCache(recordId, {
                platform: session.platform,
                selfId: session.selfId,
                userId,
                username: session.username || userId
            })

            if (session.username) {
                cache.record.username = session.username
            }

            const cacheExpired = this.isPersonaCacheExpired(
                cache.record.lastAnalysisAt
            )
            const shouldRefresh = force || cacheExpired || !cache.parsedPersona

            if (shouldRefresh) {
                if (!force && cache.parsedPersona && cacheExpired) {
                    const ttlDays = this.config.personaCacheLifetimeDays
                    if (ttlDays > 0) {
                        await session.send(
                            `上次用户画像更新已超过 ${ttlDays} 天，正在重新生成画像。`
                        )
                    }
                }

                await this.runPersonaAnalysis(cache)

                if (!cache.parsedPersona) {
                    message = h.text(
                        '暂未收集到足够的聊天记录来生成该用户的画像，请稍后再试。'
                    )
                    await session.send(message)
                    return
                }

                cache.pendingMessages = 0
            }

            const profile = cache.parsedPersona!

            let displayName = cache.record.username
            let avatar: string | undefined
            try {
                const user = await bot.getUser(userId, session.guildId)
                avatar = user.avatar
                const resolvedName =
                    (user as { nick?: string; name?: string }).nick ||
                    (user as { name?: string }).name
                if (resolvedName) {
                    displayName = resolvedName
                    cache.record.username = resolvedName
                }
            } catch (e) {
                this.ctx.logger.warn(`获取用户 ${userId} 信息失败: ${e}`)
            }

            if (!avatar && session.platform === 'onebot') {
                avatar = getAvatarUrl(userId)
            }

            const image =
                await this.ctx.chatluna_group_analysis_renderer.renderUserPersona(
                    profile,
                    displayName,
                    avatar
                )

            message =
                typeof image === 'string'
                    ? h.text(image)
                    : h.image(image, 'image/png')
        } catch (error) {
            this.ctx.logger.error(
                `为用户 ${userId} 执行画像分析时发生错误:`,
                error
            )
            const errorMessage =
                error instanceof Error ? error.message : '未知错误。'

            message = h.text(
                `分析失败: ${errorMessage}。请检查服务状态或联系管理员。`
            )
        }

        await session.send(message)
    }

    public async analyzeGroupMessages(
        messages: StoredMessage[],
        selfId: string,
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

        const bot = this._getBot(selfId)
        let groupName = guildId
        if (bot) {
            try {
                groupName = (await bot.getGuild(guildId)).name || guildId
            } catch (err) {
                this.ctx.logger.warn(`获取群组 ${guildId} 名称失败: ${err}`)
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

    interface Tables {
        chatluna_user_personas: PersonaRecord
    }
}
