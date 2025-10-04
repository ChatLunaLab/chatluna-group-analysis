import { $, Bot, Context, h, Query, Service, Session } from 'koishi'
import { Config } from '../config'
import {
    ActivityStats,
    MessageFilter,
    OneBotMessage,
    PersistenceBuffer,
    StoredMessage
} from '../types'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { getAvatarUrl, inferPlatformInfo, isLagrangeBot } from '../utils'
import { CQCode } from '../onebot/cqcode'

export class MessageService extends Service {
    private messageCache = new Map<string, StoredMessage[]>()
    private readonly cacheSize = 1000
    private readonly cacheExpiration = 1000 * 60 * 24 // 1 days
    private messageHandlers: Array<(session: Session) => void | Promise<void>> =
        []
    private activityStats = new Map<string, ActivityStats>()
    private persistenceBuffers = new Map<string, PersistenceBuffer>()
    private readonly activityWindowMs = 60 * 1000
    private readonly highActivityThreshold = 30
    private readonly bufferFlushSize = 50
    private readonly bufferIdleFlushMs = 30 * 1000
    private readonly bufferSweepIntervalMs = 30 * 1000
    private warnedOneBotPersistence = true

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_message', true)
        this.setupDatabase()
        this.setupMessageListener()
        this.setupCacheCleanup()
        this.setupPersistenceTasks()
    }

    public onUserMessage(handler: (session: Session) => void | Promise<void>) {
        this.messageHandlers.push(handler)
    }

    private setupDatabase() {
        this.ctx.database.extend(
            'chatluna_messages',
            {
                id: 'string',
                platform: 'string',
                selfId: 'string',
                channelId: 'string',
                guildId: { type: 'string', nullable: true },
                userId: 'string',
                username: 'string',
                content: 'text',
                avatarUrl: 'string',
                timestamp: 'timestamp',
                messageId: { type: 'string', nullable: true }
            },
            { primary: 'id' }
        )
    }

    private setupMessageListener() {
        this.ctx.on('message', async (session) => {
            if (this.shouldListenToMessage(session)) {
                await this.handleMessage(session)
            }
        })
    }

    private shouldListenToMessage(session: Session): boolean {
        // TODO: private message
        if (!session.guildId && !session.channelId) return false

        return this.config.listenerGroups.some(
            (listener) =>
                listener.enabled &&
                listener.platform === session.platform &&
                listener.selfId === session.selfId &&
                listener.channelId === session.channelId &&
                (!listener.guildId || listener.guildId === session.guildId)
        )
    }

    private async handleMessage(session: Session) {
        const uniqueId = session.messageId
            ? `${session.platform}_${session.messageId}`
            : `${session.platform}_${session.selfId}_${session.channelId}_${Date.now()}_${Math.random()
                  .toString(36)
                  .substring(2, 9)}`
        const storedMessage: StoredMessage = {
            id: uniqueId,
            platform: session.platform,
            selfId: session.selfId,
            channelId: session.channelId || '0',
            guildId: session.guildId || '0',
            userId: session.userId,
            avatarUrl: session.event.user?.avatar || '',
            username: session.username,
            content: session.content,
            timestamp: new Date(session.timestamp * 1000),
            messageId: session.messageId
        }

        // Add to local cache
        this.addToCache(storedMessage)

        await this.persistIncomingMessage(session, storedMessage)

        // Notify all registered handlers
        for (const handler of this.messageHandlers) {
            try {
                await handler(session)
            } catch (error) {
                this.ctx.logger.warn('Message handler error:', error)
            }
        }
    }

    private addToCache(message: StoredMessage) {
        const cacheKey = `${message.platform}_${message.guildId || message.channelId}`
        let messages = this.messageCache.get(cacheKey) || []

        messages.unshift(message)

        // Keep only recent messages in cache
        if (messages.length > this.cacheSize) {
            messages = messages.slice(0, this.cacheSize)
        }

        this.messageCache.set(cacheKey, messages)
    }

    private setupCacheCleanup() {
        // Clean up expired cache entries every 5 minutes
        this.ctx.setInterval(
            () => {
                const now = Date.now()
                for (const [key, messages] of this.messageCache.entries()) {
                    const validMessages = messages.filter(
                        (msg) =>
                            now - msg.timestamp.getTime() < this.cacheExpiration
                    )

                    if (validMessages.length === 0) {
                        this.messageCache.delete(key)
                    } else if (validMessages.length !== messages.length) {
                        this.messageCache.set(key, validMessages)
                    }
                }
            },
            5 * 60 * 1000
        )
    }

    private setupPersistenceTasks() {
        this.ctx.setInterval(() => {
            void this.flushIdleBuffers()
        }, this.bufferSweepIntervalMs)

        this.ctx.on('dispose', () => {
            void this.flushAllBuffers()
        })

        const retentionDays = this.config.retentionDays
        if (retentionDays > 0) {
            const retentionMs = retentionDays * 24 * 60 * 60 * 1000
            this.ctx.setInterval(
                () => {
                    const cutoff = new Date(Date.now() - retentionMs)
                    const removalQuery: Query<StoredMessage> = {
                        timestamp: { $lt: cutoff }
                    }
                    void this.ctx.database
                        .remove('chatluna_messages', removalQuery)
                        .catch((error) =>
                            this.ctx.logger.warn(
                                'Failed to cleanup expired cached messages:',
                                error
                            )
                        )
                },
                6 * 60 * 60 * 1000
            )
        }
    }

    private async getBotAPIHistoricalMessages(
        filter: MessageFilter,
        bot: Bot
    ): Promise<StoredMessage[]> {
        const logger = this.ctx.logger
        const targetId = filter.channelId || filter.guildId

        if (!targetId) {
            logger.warn(
                'Bot API historical messages require channelId or guildId'
            )
            return []
        }

        const limit = filter.limit || 100
        const startTime =
            filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000) // Default 1 day
        const endTime = filter.endTime || new Date()

        const allMessages: StoredMessage[] = []
        let fetchedCount = 0
        let queryRounds = 0
        let nextId: string

        try {
            while (fetchedCount < limit) {
                const messageList = await bot.getMessageList(
                    targetId,
                    nextId,
                    'before'
                )

                if (!messageList?.data?.length) break

                queryRounds++

                const batch = messageList.data.map((msg) => ({
                    id: `${bot.platform}_${bot.selfId}_${targetId}_${msg.id}`,
                    platform: bot.platform,
                    selfId: bot.selfId,
                    channelId: filter.channelId,
                    guildId: msg.guild?.id ?? filter.guildId,
                    userId: msg.user.id,
                    username:
                        msg.member?.name ?? msg.user.name ?? msg.user.nick,
                    content: msg.content,
                    timestamp: new Date(msg.createdAt ?? msg.timestamp),
                    messageId: msg.id,
                    avatarUrl: msg.user.avatar || '',
                    elements: h.parse(msg.content).concat(
                        msg.quote
                            ? h(
                                  'quote',
                                  {
                                      id: msg.quote.id,
                                      userId: msg.quote.user.id,
                                      name: msg.quote.user.name
                                  },
                                  msg.quote.elements
                              )
                            : []
                    )
                }))

                const validMessages = batch.filter((msg) => {
                    const withinTimeRange =
                        msg.timestamp >= startTime && msg.timestamp <= endTime
                    const matchesUser =
                        !filter.userId ||
                        filter.userId.length < 1 ||
                        filter.userId.includes(msg.userId)
                    const hitFilterContent = !this.config.wordsFilter.some(
                        (word) => msg.content.includes(word) /* ||
                            msg.username.includes(word) */
                    )

                    // Apply purpose-based filtering
                    let purposeFilter = true
                    if (filter.purpose === 'group-analysis') {
                        // Filter out users in userFilter for group analysis
                        purposeFilter = !this.config.userFilter.includes(
                            msg.userId
                        )
                    } else if (filter.purpose === 'user-persona') {
                        // Filter out users in personaUserFilter for user persona
                        purposeFilter = !this.config.personaUserFilter.includes(
                            msg.userId
                        )
                    }

                    return (
                        withinTimeRange &&
                        matchesUser &&
                        hitFilterContent &&
                        purposeFilter
                    )
                })

                allMessages.unshift(...validMessages)
                fetchedCount += validMessages.length

                const oldestMsg = batch[0]

                if (oldestMsg.timestamp < startTime) {
                    logger.info(
                        `群 ${targetId} [第 ${queryRounds} 轮] 获取了 ${validMessages.length} 条消息。最旧消息: ${oldestMsg.timestamp.toLocaleString()}`
                    )
                    break
                }

                nextId = messageList.prev || oldestMsg.messageId
                if (fetchedCount >= limit || !nextId?.length) {
                    logger.info(
                        `群 ${targetId} [第 ${queryRounds} 轮] 获取了 ${validMessages.length} 条消息。最旧消息: ${oldestMsg.timestamp.toLocaleString()}`
                    )
                    break
                }
            }

            return allMessages.slice(0, limit)
        } catch (error) {
            logger.error('Failed to fetch Bot API historical messages:', error)
            if (!this.config.alwaysPersistMessages) {
                logger.info(
                    '获取历史消息失败，建议启用消息持久化功能以降低对平台历史接口的依赖。'
                )
            }
            return []
        }
    }

    public async getHistoricalMessages(
        filter: MessageFilter
    ): Promise<StoredMessage[]> {
        const { platform, selfId } = inferPlatformInfo(
            filter,
            this.config.listenerGroups
        )
        const bot = this.ctx.bots.find(
            (b) => b.platform === platform && b.selfId === selfId
        )

        if (platform === 'onebot') {
            this.ctx.logger.info('使用 OneBot 历史消息获取功能。')
            return this.getOneBotHistoricalMessages(filter)
        }

        if (bot?.['getMessageList']) {
            this.ctx.logger.info('使用 Bot API 历史消息获取功能。')
            return this.getBotAPIHistoricalMessages(filter, bot)
        }

        this.ctx.logger.warn(
            '未找到可用的适配器，将使用数据库历史消息获取功能。'
        )
        return this.getDatabaseHistoricalMessages(filter)
    }

    private async getOneBotHistoricalMessages(
        filter: MessageFilter
    ): Promise<StoredMessage[]> {
        const logger = this.ctx.logger
        const targetId = filter.guildId || filter.channelId

        if (!targetId) {
            logger.warn(
                'OneBot historical messages require guildId or channelId'
            )
            return []
        }

        const bot = this.ctx.bots.find(
            (b) =>
                b.platform === 'onebot' &&
                b.selfId === (filter.selfId ?? b.selfId)
        ) as OneBotBot<Context, OneBotBot.Config>

        if (!bot || bot.platform !== 'onebot') {
            logger.warn('No OneBot instance found')
            return []
        }

        const { isRunningLagrange, botAppName } = await isLagrangeBot(bot)

        logger.info(
            `是否运行在 Lagrange: ${isRunningLagrange}, 具体的 OneBot 实例: ${botAppName}`
        )

        const messages: OneBotMessage[] = []
        const limit = filter.limit || 100
        const startTime =
            filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000) // Default 1 day
        const endTime = filter.endTime || new Date()

        let messageSeq = 0
        let fetchedCount = 0
        let queryRounds = 0
        let oldestMsg: OneBotMessage | null = null

        try {
            while (fetchedCount < limit) {
                const requestPackage = {
                    group_id: Number(targetId),
                    message_seq: messageSeq,
                    count: 50,
                    reverseOrder: messageSeq !== 0
                }

                if (isRunningLagrange) {
                    delete requestPackage.reverseOrder
                    requestPackage.count = 30
                }

                const result = await bot.internal
                    ._request('get_group_msg_history', requestPackage)
                    .then(
                        (result) => result.data as { messages: OneBotMessage[] }
                    )

                if (!result?.messages?.length) {
                    logger.info(
                        `群 ${targetId} [第 ${queryRounds} 轮] 最旧消息: ${new Date((oldestMsg?.time || 0) * 1000).toLocaleString()}`
                    )
                    break
                }

                queryRounds++

                const batch: OneBotMessage[] = isRunningLagrange
                    ? result.messages.reverse()
                    : result.messages
                const validMessages = batch.filter((msg) => {
                    const msgTime = new Date(msg.time * 1000)
                    const withinTimeRange =
                        msgTime >= startTime && msgTime <= endTime
                    const userId = String(msg.sender?.user_id)
                    const matchesUser =
                        !filter.userId ||
                        filter.userId.length < 1 ||
                        filter.userId.includes(userId)

                    const hitFilterContent = !this.config.wordsFilter.some(
                        (word) => msg.raw_message.includes(word) /* ||
                            msg.sender.nickname.includes(word) */
                    )

                    // Apply purpose-based filtering
                    let purposeFilter = true
                    if (filter.purpose === 'group-analysis') {
                        // Filter out users in userFilter for group analysis
                        purposeFilter = !this.config.userFilter.includes(userId)
                    } else if (filter.purpose === 'user-persona') {
                        // Filter out users in personaUserFilter for user persona
                        purposeFilter =
                            !this.config.personaUserFilter.includes(userId)
                    }

                    return (
                        withinTimeRange &&
                        matchesUser &&
                        hitFilterContent &&
                        purposeFilter
                    )
                })

                messages.unshift(...validMessages)
                fetchedCount += validMessages.length

                if (
                    (batch?.[0]?.time || 0) * 1000 < startTime.getTime() ||
                    batch[0].time === oldestMsg?.time ||
                    batch.length === 0
                ) {
                    logger.info(
                        `群 ${targetId} [第 ${queryRounds} 轮] 获取了 ${validMessages.length} 条消息。最旧消息: ${new Date(batch[0].time * 1000).toLocaleString()}`
                    )
                    break
                }

                oldestMsg = batch[0]

                messageSeq = oldestMsg.message_seq
            }

            // Convert to StoredMessage format
            const results = messages.map((msg) => ({
                id: `onebot_${msg.message_id}`,
                platform: 'onebot',
                selfId: bot.selfId,
                channelId: targetId,
                guildId: filter.guildId,
                userId: String(msg.sender.user_id),
                username: msg.sender.nickname,
                content: msg.raw_message || '',
                avatarUrl: getAvatarUrl(msg.sender.user_id),
                timestamp: new Date(msg.time * 1000),
                messageId: String(msg.message_id),
                elements: CQCode.parse(msg.raw_message)
            }))

            return results
        } catch (error) {
            logger.error('Failed to fetch OneBot historical messages:', error)
            if (!this.config.alwaysPersistMessages) {
                logger.info(
                    'OneBot 历史消息获取失败，建议启用消息持久化功能以降低接口调用失败的影响。'
                )
            }
            return []
        }
    }

    private async getDatabaseHistoricalMessages(
        filter: MessageFilter
    ): Promise<StoredMessage[]> {
        try {
            const query: Query<StoredMessage> = {}

            if (filter.guildId) query.guildId = filter.guildId
            if (filter.channelId) query.channelId = filter.channelId
            if (filter.userId)
                query.userId = {
                    $in: filter.userId
                }

            if (filter.startTime || filter.endTime) {
                query.timestamp = {}
                if (filter.startTime) query.timestamp.$gte = filter.startTime
                if (filter.endTime) query.timestamp.$lte = filter.endTime
            }

            // Apply purpose-based filtering
            if (
                filter.purpose === 'group-analysis' &&
                this.config.userFilter.length > 0
            ) {
                // Exclude users in userFilter for group analysis
                query.userId = query.userId
                    ? {
                          $in: filter.userId.filter(
                              (userId) =>
                                  !this.config.userFilter.includes(userId)
                          )
                      }
                    : { $nin: this.config.userFilter }
            } else if (
                filter.purpose === 'user-persona' &&
                this.config.personaUserFilter.length > 0
            ) {
                // Exclude users in personaUserFilter for user persona
                query.userId = query.userId
                    ? {
                          $in: filter.userId.filter(
                              (userId) =>
                                  !this.config.userFilter.includes(userId)
                          )
                      }
                    : { $nin: this.config.personaUserFilter }
            }

            const messages = await this.ctx.database
                .select('chatluna_messages')
                .where(query)
                .offset(filter.offset ?? 0)
                .limit(filter.limit ?? 100)
                .orderBy(($) => $.timestamp, 'desc')
                .execute()

            return messages.map((message) => ({
                ...message,
                elements: h.parse(message.content)
            }))
        } catch (error) {
            this.ctx.logger.error(
                'Failed to fetch database historical messages:',
                error
            )
            return []
        }
    }

    private getPersistenceKey(message: StoredMessage) {
        const scope = message.guildId || message.channelId || 'global'
        return `${message.platform}_${message.selfId}_${scope}`
    }

    private getActivityStats(key: string, timestamp: Date): ActivityStats {
        const now = timestamp.getTime()
        const stats = this.activityStats.get(key)
        if (!stats || now - stats.windowStart > this.activityWindowMs) {
            const fresh = { windowStart: now, count: 0 }
            this.activityStats.set(key, fresh)
            return fresh
        }
        return stats
    }

    private async persistIncomingMessage(
        session: Session,
        storedMessage: StoredMessage
    ) {
        if (this.config.alwaysPersistMessages) {
            await this.enqueueMessageForPersistence(storedMessage)
            return
        }

        if (session.platform !== 'onebot' && !session.bot['getMessageList']) {
            await this.persistMessages([storedMessage])
        }
    }

    private async enqueueMessageForPersistence(message: StoredMessage) {
        const key = this.getPersistenceKey(message)
        const stats = this.getActivityStats(key, message.timestamp)
        stats.count += 1

        if (stats.count < this.highActivityThreshold) {
            await this.flushPendingBuffer(key)
            await this.persistMessages([message])
            return
        }

        const buffer = this.persistenceBuffers.get(key) || {
            messages: [],
            lastMessageAt: 0
        }
        buffer.messages.push(message)
        buffer.lastMessageAt = Date.now()
        this.persistenceBuffers.set(key, buffer)

        if (buffer.messages.length >= this.bufferFlushSize) {
            await this.flushPendingBuffer(key)
        }
    }

    private async flushPendingBuffer(key: string) {
        const buffer = this.persistenceBuffers.get(key)
        if (!buffer || buffer.messages.length === 0) return

        const payload = buffer.messages.splice(0, buffer.messages.length)
        this.persistenceBuffers.delete(key)
        await this.persistMessages(payload)
    }

    private async flushIdleBuffers() {
        const now = Date.now()
        const tasks: Array<Promise<void>> = []

        for (const [key, buffer] of this.persistenceBuffers.entries()) {
            if (buffer.messages.length === 0) {
                this.persistenceBuffers.delete(key)
                continue
            }

            if (now - buffer.lastMessageAt >= this.bufferIdleFlushMs) {
                tasks.push(this.flushPendingBuffer(key))
            }
        }

        await Promise.allSettled(tasks)

        for (const [key, stats] of this.activityStats.entries()) {
            if (now - stats.windowStart > this.activityWindowMs) {
                this.activityStats.delete(key)
            }
        }
    }

    private async flushAllBuffers() {
        const tasks = Array.from(this.persistenceBuffers.keys()).map((key) =>
            this.flushPendingBuffer(key)
        )
        await Promise.allSettled(tasks)
    }

    private async persistMessages(messages: StoredMessage[]) {
        if (!messages.length) return

        try {
            await this.ctx.database.upsert('chatluna_messages', messages)
        } catch (error) {
            this.ctx.logger.warn('Failed to store message in database:', error)
        }
    }

    public getRecentMessages(
        guildId?: string,
        channelId?: string,
        limit = 100
    ): StoredMessage[] {
        const platform =
            this.config.listenerGroups.find(
                (l) =>
                    (!guildId || l.guildId === guildId) &&
                    (!channelId || l.channelId === channelId)
            )?.platform || 'unknown'

        const cacheKey = `${platform}_${guildId || channelId}`
        const cached = this.messageCache.get(cacheKey) || []
        return cached.slice(0, limit)
    }

    public async getMessageStats(filter: MessageFilter): Promise<{
        totalCount: number
        userCount: number
        timeRange: { start: Date; end: Date } | null
    }> {
        const messages = await this.getHistoricalMessages({
            ...filter,
            limit: 10000
        })
        const uniqueUsers = new Set(messages.map((m) => m.userId))
        const timestamps = messages.map((m) => m.timestamp).sort()

        return {
            totalCount: messages.length,
            userCount: uniqueUsers.size,
            timeRange:
                timestamps.length > 0
                    ? {
                          start: timestamps[0],
                          end: timestamps[timestamps.length - 1]
                      }
                    : null
        }
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_message: MessageService
    }

    interface Tables {
        chatluna_messages: StoredMessage
    }
}
