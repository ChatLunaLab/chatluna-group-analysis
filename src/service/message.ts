import { Context, h, Query, Service, Session, sleep } from 'koishi'
import { Config } from '../config'
import { OneBotMessage } from '../types'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { inferPlatformInfo } from '../utils'

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
    private messageCache: Map<string, StoredMessage[]> = new Map()
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
            {
                primary: 'id'
            }
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

        return this.config.listenerGroups.some((listener) => {
            return (
                listener.enabled &&
                listener.platform === session.platform &&
                listener.selfId === session.selfId &&
                listener.channelId === session.channelId &&
                (!listener.guildId || listener.guildId === session.guildId)
            )
        })
    }

    private async handleMessage(session: Session) {
        const messageId = `${session.platform}_${session.selfId}_${session.channelId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

        const storedMessage: StoredMessage = {
            id: messageId,
            platform: session.platform,
            selfId: session.selfId,
            channelId: session.channelId,
            guildId: session.guildId,
            userId: session.userId,
            username: session.username,
            content: session.content,
            timestamp: new Date(),
            messageId: session.messageId
        }

        // Add to local cache
        this.addToCache(storedMessage)

        if (session.platform !== 'onebot') {
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

    public async getHistoricalMessages(
        filter: MessageFilter
    ): Promise<StoredMessage[]> {
        const { platform } = inferPlatformInfo(
            filter,
            this.config.listenerGroups
        )

        if (platform === 'onebot') {
            return this.getOneBotHistoricalMessages(filter)
        } else {
            return this.getDatabaseHistoricalMessages(filter)
        }
    }

    private async getOneBotHistoricalMessages(
        filter: MessageFilter
    ): Promise<StoredMessage[]> {
        const logger = this.ctx.logger('MessageService:OneBot')

        if (!filter.guildId && !filter.channelId) {
            logger.warn(
                'OneBot historical messages require guildId or channelId'
            )
            return []
        }

        const bot: OneBotBot<Context, OneBotBot.Config> = this.ctx.bots.find(
            (b) =>
                b.platform === 'onebot' &&
                b.selfId === (filter.selfId ?? b.selfId)
        ) as OneBotBot<Context, OneBotBot.Config>

        if (!bot || bot.platform !== 'onebot') {
            logger.warn('No OneBot instance found')
            return []
        }

        const messages: OneBotMessage[] = []
        const targetId = filter.guildId || filter.channelId
        const limit = filter.limit || 100
        const startTime =
            filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000) // Default 1 day
        const endTime = filter.endTime || new Date()

        let messageSeq = 0
        let fetchedCount = 0

        try {
            while (fetchedCount < limit) {
                const result = await bot.internal
                    ._request('get_group_msg_history', {
                        group_id: Number(targetId),
                        message_seq: messageSeq || 0
                    })
                    .then(
                        (result) =>
                            result.data as {
                                messages: OneBotMessage[]
                            }
                    )

                if (!result?.messages?.length) break

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

                messages.push(...validMessages)
                fetchedCount += validMessages.length

                const oldestMsg = batch[batch.length - 1]
                if (new Date(oldestMsg.time * 1000) < startTime) break

                messageSeq = oldestMsg.message_id

                // Rate limiting
                await sleep(this.config.apiCallDelay || 800)
            }

            // Convert to StoredMessage format
            return messages.slice(0, limit).map((msg) => ({
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
                elements: h.parse(msg.raw_message)
            }))
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

            const selections = this.ctx.database
                .select('chatluna_messages')
                .where(query)
                .offset(filter.offset ?? 0)
                .limit(filter.limit ?? 100)
                .orderBy(($) => $.timestamp, 'desc')

            const messages = await selections.execute()
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
        const cacheKey = `${
            this.config.listenerGroups.find(
                (l) =>
                    (!guildId || l.guildId === guildId) &&
                    (!channelId || l.channelId === channelId)
            )?.platform || 'unknown'
        }_${guildId || channelId}`

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
