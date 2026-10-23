import { Context, h, Query } from 'koishi'
import { Config } from '../../config'
import { MessageFilter, StoredMessage } from '../../types'
import { filterHistoryMessages } from './shared'

export async function readDatabaseHistory(
    ctx: Context,
    config: Config,
    filter: MessageFilter
) {
    const query: Query<StoredMessage> = {}
    if (filter.platform) query.platform = filter.platform
    if (filter.selfId) query.selfId = filter.selfId
    if (filter.guildId) query.guildId = filter.guildId
    if (filter.channelId) query.channelId = filter.channelId
    if (filter.userId && filter.userId.length)
        query.userId = { $in: filter.userId }
    if (filter.startTime || filter.endTime) {
        query.timestamp = {}
        if (filter.startTime) query.timestamp.$gte = filter.startTime
        if (filter.endTime) query.timestamp.$lte = filter.endTime
    }

    const batchSize = Math.max(50, Math.min(filter.limit * 2, 500))
    const messages: StoredMessage[] = []
    let offset = filter.offset || 0

    while (messages.length < filter.limit) {
        const batch = await ctx.database
            .select('chatluna_messages')
            .where(query)
            .offset(offset)
            .limit(batchSize)
            .orderBy(($) => $.timestamp, 'desc')
            .execute()

        const parsed = batch.map((message) => ({
            ...message,
            timestamp: new Date(message.timestamp),
            elements: h.parse(message.content)
        }))
        messages.push(...filterHistoryMessages(parsed, filter, config))

        offset += batch.length
        if (batch.length < batchSize) break
    }

    return messages.slice(0, filter.limit)
}
