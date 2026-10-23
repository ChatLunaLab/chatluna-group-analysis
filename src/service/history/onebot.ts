import { Context } from 'koishi'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { Config } from '../../config'
import { MessageFilter, OneBotMessage, StoredMessage } from '../../types'
import { getAvatarUrl } from '../../utils/message'
import { parseCQCode } from '../../onebot/cqcode'
import { filterHistoryMessages } from './shared'

export async function readOneBotHistory(
    ctx: Context,
    config: Config,
    filter: MessageFilter
) {
    const targetId = filter.guildId || filter.channelId
    if (!targetId) return []

    const bot = ctx.bots.find(
        (item) =>
            item.platform === 'onebot' &&
            (!filter.selfId || item.selfId === filter.selfId)
    ) as OneBotBot<Context, OneBotBot.Config>
    if (!bot) return []

    const version = await bot.internal._request('get_version_info', {})
    const appName = String(version.data.app_name).toLowerCase()
    const isNapCat = appName.includes('napcat')
    const startTime =
        filter.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000)
    const requestFilter = { ...filter, startTime }
    const messages: StoredMessage[] = []
    let messageSeq: number | undefined
    let messageId: number | undefined
    let oldestTime: number | undefined

    while (messages.length < filter.limit) {
        const request: Record<string, unknown> = {
            group_id: Number(targetId),
            message_seq: messageSeq,
            message_id: messageId,
            count: isNapCat ? 50 : 30
        }
        if (isNapCat && messageSeq !== undefined) request.reverseOrder = true
        if (messageSeq === undefined) {
            delete request.message_id
            delete request.message_seq
        }

        const result = await bot.internal._request(
            'get_group_msg_history',
            request
        )
        const batch = (result.data as { messages: OneBotMessage[] }).messages
        if (!batch.length) break

        const parsed = batch.map((msg): StoredMessage => {
            const content = msg.raw_message || ''
            return {
                id: `onebot_${bot.selfId}_${targetId}_${msg.message_id}`,
                platform: 'onebot',
                selfId: bot.selfId,
                channelId: filter.channelId || targetId,
                guildId: filter.guildId,
                userId: String(msg.sender.user_id),
                username: msg.sender.nickname,
                content,
                avatarUrl: getAvatarUrl(msg.sender.user_id),
                timestamp: new Date(msg.time * 1000),
                messageId: String(msg.message_id),
                elements: parseCQCode(content)
            }
        })
        messages.push(...filterHistoryMessages(parsed, requestFilter, config))

        const currentOldest = batch[0].time
        if (
            currentOldest * 1000 < startTime.getTime() ||
            currentOldest === oldestTime
        )
            break
        oldestTime = currentOldest
        messageSeq = batch[0].message_seq
        messageId = batch[0].message_id
    }

    return messages
}
