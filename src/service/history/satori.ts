import { Bot, Context, h } from 'koishi'
import { Config } from '../../config'
import { MessageFilter, StoredMessage } from '../../types'
import { filterHistoryMessages } from './shared'

export async function readSatoriHistory(
    ctx: Context,
    config: Config,
    filter: MessageFilter,
    bot: Bot
) {
    const targetId = filter.channelId || filter.guildId
    if (!targetId) return []

    const startTime =
        filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000)
    const requestFilter = { ...filter, startTime }
    const messages: StoredMessage[] = []
    let nextId: string | undefined

    while (messages.length < filter.limit) {
        const messageList = await bot.getMessageList(targetId, nextId, 'before')
        if (!messageList.data.length) break

        const parsed = messageList.data.map((msg): StoredMessage => {
            const elements = h.parse(msg.content)
            if (msg.quote) {
                elements.push(
                    h(
                        'quote',
                        {
                            id: msg.quote.id,
                            userId: msg.quote.user.id,
                            name: msg.quote.user.name
                        },
                        msg.quote.elements
                    )
                )
            }

            return {
                id: `${bot.platform}_${bot.selfId}_${targetId}_${msg.id}`,
                platform: bot.platform,
                selfId: bot.selfId,
                channelId: filter.channelId || targetId,
                guildId: msg.guild ? msg.guild.id : filter.guildId,
                userId: msg.user.id,
                username:
                    msg.member && msg.member.name
                        ? msg.member.name
                        : msg.user.name || msg.user.nick,
                content: msg.content,
                timestamp: new Date(msg.createdAt || msg.timestamp),
                messageId: msg.id,
                avatarUrl: msg.user.avatar || '',
                elements
            }
        })
        messages.push(...filterHistoryMessages(parsed, requestFilter, config))

        const oldest = parsed[0]
        if (oldest.timestamp < startTime) break
        const cursor = messageList.prev || oldest.messageId
        if (!cursor || cursor === nextId) break
        nextId = cursor
    }

    return messages
}
