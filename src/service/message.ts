import { Bot, Context, h, Query, Service, Session } from 'koishi'
import { Config } from '../config'
import { OneBotMessage } from '../types'
import { type OneBotBot } from 'koishi-plugin-adapter-onebot'
import { inferPlatformInfo } from '../utils'
import { writeFile } from 'fs/promises'
import path from 'path'

export interface MessageFilter {
    guildId?: string
    channelId?: string
    userId?: string | number
    selfId?: string
    startTime?: Date
    endTime?: Date
    limit?: number
    offset?: number
}

export interface StoredMessage {
    id: string
    platform: string
    selfId: string
    channelId: string
    guildId?: string
    userId: string
    username: string
    content: string
    timestamp: Date
    messageId?: string
    elements?: h[]
}

export class MessageService extends Service {
    private messageCache = new Map<string, StoredMessage[]>()
    private readonly cacheSize = 1000
    private readonly cacheExpiration = 1000 * 60 * 24 // 1 days

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_message', true)
        this.setupDatabase()
        this.setupMessageListener()
        this.setupCacheCleanup()
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
        const storedMessage: StoredMessage = {
            id: `${session.platform}_${session.selfId}_${session.channelId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            platform: session.platform,
            selfId: session.selfId,
            channelId: session.channelId,
            guildId: session.guildId,
            userId: session.userId,
            username: session.username,
            content: session.content,
            timestamp: new Date(session.timestamp * 1000),
            messageId: session.messageId
        }

        // Add to local cache
        this.addToCache(storedMessage)

        // Store to database for platforms without getMessageList API
        if (session.platform !== 'onebot' && !session.bot['getMessageList']) {
            try {
                await this.ctx.database.create(
                    'chatluna_messages',
                    storedMessage
                )
            } catch (error) {
                this.ctx.logger.warn(
                    'Failed to store message in database:',
                    error
                )
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
                    elements: h.parse(msg.content)
                }))

                const validMessages = batch.filter((msg) => {
                    const withinTimeRange =
                        msg.timestamp >= startTime && msg.timestamp <= endTime
                    const matchesUser =
                        !filter.userId ||
                        String(msg.userId) === String(filter.userId)
                    return withinTimeRange && matchesUser
                })

                allMessages.unshift(...validMessages)
                fetchedCount += validMessages.length

                const oldestMsg = batch[0]
                logger.info(
                    `群 ${targetId} [第 ${queryRounds} 轮] 获取了 ${validMessages.length} 条消息。最旧消息: ${oldestMsg.timestamp.toLocaleString()}`
                )

                if (oldestMsg.timestamp < startTime) break

                nextId = messageList.prev
                if (fetchedCount >= limit || !nextId?.length) break
            }

            return allMessages.slice(0, limit)
        } catch (error) {
            logger.error('Failed to fetch Bot API historical messages:', error)
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
            return this.getOneBotHistoricalMessages(filter)
        }

        if (bot?.['getMessageList']) {
            return this.getBotAPIHistoricalMessages(filter, bot)
        }

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

        await parseCQCode('')

        const bot = this.ctx.bots.find(
            (b) =>
                b.platform === 'onebot' &&
                b.selfId === (filter.selfId ?? b.selfId)
        ) as OneBotBot<Context, OneBotBot.Config>

        if (!bot || bot.platform !== 'onebot') {
            logger.warn('No OneBot instance found')
            return []
        }

        const messages: OneBotMessage[] = []
        const limit = filter.limit || 100
        const startTime =
            filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000) // Default 1 day
        const endTime = filter.endTime || new Date()

        let messageSeq = 0
        let fetchedCount = 0
        let queryRounds = 0

        try {
            while (fetchedCount < limit) {
                const result = await bot.internal
                    ._request('get_group_msg_history', {
                        group_id: Number(targetId),
                        message_seq: messageSeq,
                        count: 50,
                        reverseOrder: messageSeq !== 0
                    })
                    .then(
                        (result) => result.data as { messages: OneBotMessage[] }
                    )

                if (!result?.messages?.length) break

                queryRounds++

                const batch: OneBotMessage[] = result.messages
                const validMessages = batch.filter((msg) => {
                    const msgTime = new Date(msg.time * 1000)
                    const withinTimeRange =
                        msgTime >= startTime && msgTime <= endTime
                    const matchesUser =
                        !filter.userId ||
                        String(msg.sender?.user_id) === String(filter.userId)
                    return withinTimeRange && matchesUser
                })

                messages.unshift(...validMessages)
                fetchedCount += validMessages.length

                const oldestMsg = batch[0]
                logger.info(
                    `群 ${targetId} [第 ${queryRounds} 轮] 获取了 ${validMessages.length} 条消息。最旧消息: ${new Date(oldestMsg.time * 1000).toLocaleString()}`
                )

                if (oldestMsg.time * 1000 < startTime.getTime()) break

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
                timestamp: new Date(msg.time * 1000),
                messageId: String(msg.message_id),
                elements: CQCodeParse(msg.raw_message)
            }))

            writeFile(
                path.join(this.ctx.baseDir, 'onebot_messages2.json'),
                JSON.stringify(results, null, 2)
            )

            writeFile(
                path.join(this.ctx.baseDir, 'onebot_messages.json'),
                JSON.stringify(messages, null, 2)
            )

            return results
        } catch (error) {
            logger.error('Failed to fetch OneBot historical messages:', error)
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
            if (filter.userId) query.userId = String(filter.userId)

            if (filter.startTime || filter.endTime) {
                query.timestamp = {}
                if (filter.startTime) query.timestamp.$gte = filter.startTime
                if (filter.endTime) query.timestamp.$lte = filter.endTime
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

let CQCodeParse: typeof import('koishi-plugin-adapter-onebot').CQCode.parse

async function parseCQCode(content: string): Promise<h[]> {
    if (!CQCodeParse) {
        CQCodeParse = (await import('koishi-plugin-adapter-onebot')).CQCode
            .parse
    }

    return CQCodeParse(content)
}
