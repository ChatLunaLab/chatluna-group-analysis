import { h } from 'koishi'
import { BasicStatsResult, StoredMessage, UserStats } from '../types'

export function calculateBasicStats(
    messages: StoredMessage[]
): BasicStatsResult {
    const userStats: Record<string, UserStats> = {}
    const allMessagesText: string[] = []
    let totalChars = 0
    let totalEmojiCount = 0

    for (const msg of messages) {
        const userId = String(msg.userId)
        if (!userId) continue

        let stat = userStats[userId]
        if (!stat) {
            stat = createUserStats(msg)
            userStats[userId] = stat
        }
        stat.messageCount++
        stat.lastActive = new Date(
            Math.max(stat.lastActive.getTime(), msg.timestamp.getTime())
        )

        const hour = msg.timestamp.getHours()
        stat.activeHours[hour]++
        if (hour < 6) stat.nightMessages++

        let pureText = ''
        for (const el of msg.elements || h.parse(msg.content)) {
            if (el.type === 'text') {
                pureText += el.attrs.content
            } else if (el.type === 'quote' || el.type === 'reply') {
                stat.replyCount++
            } else if (el.type === 'at') {
                stat.atCount++
            } else if (el.type === 'face') {
                stat.emojiStats.face = (stat.emojiStats.face || 0) + 1
                totalEmojiCount++
            } else if (
                el.type === 'image' &&
                el.attrs.subType != null &&
                el.attrs.subType !== 0
            ) {
                stat.emojiStats.sticker = (stat.emojiStats.sticker || 0) + 1
                totalEmojiCount++
            }
        }

        if (pureText) {
            allMessagesText.push(
                `${msg.username}(${msg.userId}): ${pureText.trim()}`
            )
        }

        const charCount = pureText.length || msg.content.length
        stat.charCount += charCount
        totalChars += charCount
    }

    for (const stat of Object.values(userStats)) {
        const emojiCount = Object.values(stat.emojiStats).reduce(
            (sum, count) => sum + count,
            0
        )
        stat.avgChars = ratio(stat.charCount, stat.messageCount)
        stat.nightRatio = ratio(stat.nightMessages, stat.messageCount)
        stat.replyRatio = ratio(stat.replyCount, stat.messageCount)
        stat.emojiRatio = ratio(emojiCount, stat.messageCount)
    }

    return { userStats, totalChars, totalEmojiCount, allMessagesText }
}

function createUserStats(msg: StoredMessage): UserStats {
    return {
        userId: String(msg.userId),
        nickname: msg.username,
        messageCount: 0,
        charCount: 0,
        avatar: msg.avatarUrl,
        lastActive: new Date(0),
        replyCount: 0,
        atCount: 0,
        emojiRatio: 0,
        emojiStats: {},
        nightRatio: 0,
        avgChars: 0,
        replyRatio: 0,
        nightMessages: 0,
        activeHours: Object.fromEntries(
            Array.from({ length: 24 }, (_, hour) => [hour, 0])
        )
    }
}

function ratio(value: number, total: number) {
    return total ? Number((value / total).toFixed(2)) : 0
}
