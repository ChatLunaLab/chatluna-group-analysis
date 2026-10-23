import { Context, Service, Session } from 'koishi'
import { Config } from '../config'
import {
    ActivityStats,
    MessageFilter,
    PersistenceBuffer,
    StoredMessage
} from '../types'
import {
    buildMessagePersistenceKey,
    shouldListenToMessage
} from '../utils/message'
import { readHistoricalMessages } from './history'

export class MessageService extends Service {
    static readonly inject = ['database']

    private messageCache = new Map<string, StoredMessage[]>()
    private activityStats = new Map<string, ActivityStats>()
    private persistenceBuffers = new Map<string, PersistenceBuffer>()
    private messageHandlers: ((session: Session) => void | Promise<void>)[] = []

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_message', true)
        this.setupDatabase()

        ctx.on('message', async (session) => {
            if (this.shouldListen(session)) await this.handleMessage(session)
        })
        ctx.setInterval(() => this.cleanMessageCache(), 5 * 60 * 1000)
        ctx.setInterval(() => this.flushIdleBuffers(), 30 * 1000)
        ctx.setInterval(() => this.cleanExpiredMessages(), 6 * 60 * 60 * 1000)
        ctx.on('ready', () => this.cleanExpiredMessages())
        ctx.on('dispose', () => this.flushAllBuffers())
    }

    onUserMessage(handler: (session: Session) => void | Promise<void>) {
        this.messageHandlers.push(handler)
    }

    getHistoricalMessages(filter: MessageFilter) {
        return readHistoricalMessages(this.ctx, this.config, filter)
    }

    getRecentMessages(guildId?: string, channelId?: string, limit = 100) {
        const scope = guildId || channelId
        const messages: StoredMessage[] = []
        for (const [key, items] of this.messageCache) {
            if (key.endsWith(`_${scope}`)) messages.push(...items)
        }
        return messages
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit)
    }

    async getMessageStats(filter: MessageFilter) {
        const messages = await this.getHistoricalMessages({
            ...filter,
            limit: 10000
        })
        const users = new Set<string>()
        let start: Date | undefined
        let end: Date | undefined

        for (const message of messages) {
            users.add(message.userId)
            if (!start || message.timestamp < start) start = message.timestamp
            if (!end || message.timestamp > end) end = message.timestamp
        }

        return {
            totalCount: messages.length,
            userCount: users.size,
            timeRange: start && end ? { start, end } : null
        }
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

    private shouldListen(session: Session) {
        return shouldListenToMessage(
            {
                guildId: session.guildId || undefined,
                channelId: session.channelId || undefined,
                platform: session.platform,
                selfId: session.selfId
            },
            this.config.listenerGroups,
            this.config.enableAllGroupsByDefault
        )
    }

    private async handleMessage(session: Session) {
        const scope = session.channelId || session.guildId || '0'
        const messageId =
            session.messageId ||
            `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        const message: StoredMessage = {
            id: `${session.platform}_${session.selfId}_${scope}_${messageId}`,
            platform: session.platform,
            selfId: session.selfId,
            channelId: session.channelId || '0',
            guildId: session.guildId || '0',
            userId: session.userId,
            avatarUrl: session.event.user
                ? session.event.user.avatar || ''
                : '',
            username: session.username,
            content: session.content,
            timestamp: new Date(session.timestamp),
            messageId: session.messageId
        }

        this.addToCache(message)
        if (
            this.config.alwaysPersistMessages ||
            (session.platform !== 'onebot' && !session.bot.getMessageList)
        ) {
            await this.enqueueMessage(message)
        }

        for (const handler of this.messageHandlers) {
            try {
                await handler(session)
            } catch (error) {
                this.ctx.logger.warn('Message handler error:', error)
            }
        }
    }

    private addToCache(message: StoredMessage) {
        const scope = message.guildId || message.channelId
        const key = `${message.platform}_${message.selfId}_${scope}`
        const messages = this.messageCache.get(key) || []
        messages.unshift(message)
        this.messageCache.set(key, messages.slice(0, 1000))
    }

    private cleanMessageCache() {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000
        for (const [key, messages] of this.messageCache) {
            const valid = messages.filter(
                (message) => message.timestamp.getTime() > cutoff
            )
            if (valid.length) {
                this.messageCache.set(key, valid)
            } else {
                this.messageCache.delete(key)
            }
        }
    }

    private async cleanExpiredMessages() {
        if (!this.config.retentionDays) return
        const cutoff = new Date(
            Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000
        )
        try {
            await this.ctx.database.remove('chatluna_messages', {
                timestamp: { $lt: cutoff }
            })
        } catch (error) {
            this.ctx.logger.warn(
                'Failed to cleanup expired cached messages:',
                error
            )
        }
    }

    private async enqueueMessage(message: StoredMessage) {
        const key = buildMessagePersistenceKey(message)
        const now = message.timestamp.getTime()
        let stats = this.activityStats.get(key)
        if (!stats || now - stats.windowStart > 60 * 1000) {
            stats = { windowStart: now, count: 0 }
            this.activityStats.set(key, stats)
        }
        stats.count++

        if (stats.count < 30) {
            await this.flushBuffer(key)
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
        if (buffer.messages.length >= 50) await this.flushBuffer(key)
    }

    private async flushBuffer(key: string) {
        const buffer = this.persistenceBuffers.get(key)
        if (!buffer || !buffer.messages.length) return

        this.persistenceBuffers.delete(key)
        await this.persistMessages(buffer.messages)
    }

    private async flushIdleBuffers() {
        const now = Date.now()
        const tasks: Promise<void>[] = []

        for (const [key, buffer] of this.persistenceBuffers) {
            if (!buffer.messages.length) {
                this.persistenceBuffers.delete(key)
            } else if (now - buffer.lastMessageAt >= 30 * 1000) {
                tasks.push(this.flushBuffer(key))
            }
        }
        await Promise.allSettled(tasks)

        for (const [key, stats] of this.activityStats) {
            if (now - stats.windowStart > 60 * 1000)
                this.activityStats.delete(key)
        }
    }

    private async flushAllBuffers() {
        await Promise.allSettled(
            [...this.persistenceBuffers.keys()].map((key) =>
                this.flushBuffer(key)
            )
        )
    }

    private async persistMessages(messages: StoredMessage[]) {
        if (!messages.length) return
        try {
            await this.ctx.database.upsert('chatluna_messages', messages)
        } catch (error) {
            this.ctx.logger.warn('Failed to store message in database:', error)
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
