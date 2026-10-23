import { Context } from 'koishi'
import { Config } from '../../config'
import { MessageFilter } from '../../types'
import { readDatabaseHistory } from './database'
import { readOneBotHistory } from './onebot'
import { readSatoriHistory } from './satori'
import { sortHistoryMessages } from './shared'

export async function readHistoricalMessages(
    ctx: Context,
    config: Config,
    filter: MessageFilter
) {
    const listener = config.listenerGroups.find(
        (item) =>
            (!filter.platform || item.platform === filter.platform) &&
            (!filter.selfId || item.selfId === filter.selfId) &&
            (!filter.guildId || item.guildId === filter.guildId) &&
            (!filter.channelId || item.channelId === filter.channelId)
    )
    const bot = ctx.bots.find(
        (item) =>
            (!filter.platform || item.platform === filter.platform) &&
            item.selfId === filter.selfId
    )
    const request: MessageFilter = {
        ...filter,
        limit: filter.limit || 100,
        platform:
            filter.platform ||
            (listener ? listener.platform : bot && bot.platform),
        selfId: filter.selfId || (listener && listener.selfId)
    }

    try {
        const messages = await readFromSource(ctx, config, request)
        return sortHistoryMessages(messages, request)
    } catch (error) {
        ctx.logger.warn('平台历史消息读取失败，将尝试数据库兜底。', error)
        if (config.alwaysPersistMessages) return []

        const messages = await readDatabaseHistory(ctx, config, request)
        return sortHistoryMessages(messages, request)
    }
}

function readFromSource(ctx: Context, config: Config, filter: MessageFilter) {
    if (config.alwaysPersistMessages)
        return readDatabaseHistory(ctx, config, filter)
    if (filter.platform === 'onebot')
        return readOneBotHistory(ctx, config, filter)

    const bot = ctx.bots.find(
        (item) =>
            item.platform === filter.platform && item.selfId === filter.selfId
    )
    if (bot && bot['getMessageList'])
        return readSatoriHistory(ctx, config, filter, bot)
    return readDatabaseHistory(ctx, config, filter)
}
