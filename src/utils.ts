import { Context, h } from 'koishi'

import {
    BasicStatsResult,
    GroupAnalysisResult,
    StoredMessage,
    UserPersonaProfile,
    UserStats
} from './types'
import { Config } from './config'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'

import { skinRegistry } from './skins'

export function calculateBasicStats(
    messages: StoredMessage[]
): BasicStatsResult {
    const userStats: Record<string, UserStats> = {}
    let totalChars = 0
    let totalEmojiCount = 0
    const allMessagesText: string[] = []

    for (const msg of messages) {
        const userId = String(msg.userId)
        if (!userId) continue

        if (!userStats[userId]) {
            userStats[userId] = getInitialUserStats(msg)
        }

        const stat = userStats[userId]
        stat.messageCount++

        stat.lastActive = new Date(
            Math.max(stat.lastActive.getTime(), msg.timestamp.getTime())
        )

        const hour = msg.timestamp.getHours()
        stat.activeHours[hour] = (stat.activeHours[hour] || 0) + 1
        if (hour >= 0 && hour < 6) {
            stat.nightMessages++
        }

        const elements = msg.elements || h.parse(msg.content)
        let pureText = ''
        for (const el of elements) {
            if (el.type === 'text') {
                pureText += el.attrs.content
                // onebot 兼容，添加 reply
            } else if (el.type === 'quote' || el.type === 'reply') {
                stat.replyCount++
            } else if (el.type === 'at') {
                stat.atCount++
            } else if (el.type === 'face') {
                stat.emojiStats['face'] = (stat.emojiStats['face'] || 0) + 1
                totalEmojiCount++
            } else if (
                el.type === 'image' &&
                el.attrs.subType != null &&
                el.attrs.subType !== 0
            ) {
                stat.emojiStats['sticker'] =
                    (stat.emojiStats['sticker'] || 0) + 1
                totalEmojiCount++
            }
        }
        if (pureText) {
            allMessagesText.push(
                `${msg.username}(${msg.userId}): ${pureText.trim()}`
            )
        }

        stat.charCount += pureText.length || msg.content.length
        totalChars += pureText.length || msg.content.length
    }

    for (const userId in userStats) {
        const stat = userStats[userId]
        stat.avgChars = stat.messageCount
            ? parseFloat((stat.charCount / stat.messageCount).toFixed(1))
            : 0
        stat.nightRatio = stat.messageCount
            ? parseFloat((stat.nightMessages / stat.messageCount).toFixed(2))
            : 0
        stat.replyRatio = stat.messageCount
            ? parseFloat((stat.replyCount / stat.messageCount).toFixed(2))
            : 0
        stat.emojiRatio = stat.messageCount
            ? parseFloat((totalEmojiCount / stat.messageCount).toFixed(2))
            : 0
    }

    return { userStats, totalChars, totalEmojiCount, allMessagesText }
}

function getInitialUserStats(msg: StoredMessage): UserStats {
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
            Array.from({ length: 24 }, (_, i) => [i, 0])
        )
    }
}

export function generateTextReport(result: GroupAnalysisResult): string {
    let report = `📊 群聊分析报告 (${result.analysisDate})\n`
    report += `群组: ${result.groupName}\n\n`
    report += `总消息: ${result.totalMessages} | 参与人数: ${result.totalParticipants} | 总字数: ${result.totalChars} | 表情: ${result.emojiCount}\n`
    report += `最活跃时段: ${result.mostActivePeriod}\n\n`

    report += `💬 热门话题:\n`
    if (result.topics?.length) {
        result.topics.forEach((t) => {
            report += `- ${t.topic} (参与者: ${t.contributors.join(', ')})\n  ${t.detail}\n`
        })
    } else {
        report += '无明显话题\n'
    }

    report += `\n🏆 群友称号:\n`
    if (result.userTitles?.length) {
        result.userTitles.forEach((t) => {
            report += `- ${t.name}: ${t.title} ${t.mbti && t.mbti !== 'N/A' ? `(${t.mbti})` : ''} - ${t.reason}\n`
        })
    } else {
        report += '无特殊称号\n'
    }

    report += `\n💬 群圣经:\n`
    if (result.goldenQuotes?.length) {
        result.goldenQuotes.forEach((q) => {
            report += `- "${q.content}" —— ${q.sender}\n  理由: ${q.reason}\n`
        })
    } else {
        report += '无金句记录\n'
    }

    return report
}

export function getAvatarUrl(userId: number | string): string {
    return `http://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
}

export function formatUserStats(
    userStats: UserStats[],
    skin: string = 'md3'
): string {
    const renderer = skinRegistry.getSafe(skin)
    return renderer.formatUserStats(userStats)
}

export function formatGoldenQuotes(
    quotes: GroupAnalysisResult['goldenQuotes'],
    skin: string = 'md3'
): string {
    const renderer = skinRegistry.getSafe(skin)
    return renderer.formatGoldenQuotes(quotes)
}

export function formatUserTitles(
    userTitles: GroupAnalysisResult['userTitles'],
    skin: string = 'md3'
): string {
    const renderer = skinRegistry.getSafe(skin)
    return renderer.formatUserTitles(userTitles)
}

export function formatTopics(
    topics: GroupAnalysisResult['topics'],
    skin: string = 'md3'
): string {
    const renderer = skinRegistry.getSafe(skin)
    return renderer.formatTopics(topics)
}

export function generateActiveHoursChart(
    activeHours: Record<number, number>,
    skin: string = 'md3'
): string {
    const renderer = skinRegistry.getSafe(skin)
    return renderer.generateActiveHoursChart(activeHours)
}

export function renderTemplate(
    template: string,
    data: Record<string, string>
): string {
    return template.replace(/\$\{(.*?)\}/g, (_, key) => data[key] || '')
}

export function shouldListenToMessage(
    session: {
        guildId?: string
        channelId?: string
        platform: string
        selfId: string
    },
    listenerGroups: {
        enabled: boolean
        platform: string
        selfId: string
        channelId: string
        guildId?: string
    }[],
    enableAllGroupsByDefault = false
): boolean {
    if (!session.guildId && !session.channelId) return false
    if (enableAllGroupsByDefault) return true

    return listenerGroups.some((listener) => {
        if (
            !listener.enabled ||
            listener.platform !== session.platform ||
            listener.selfId !== session.selfId
        ) {
            return false
        }

        const channelMatches =
            !!listener.channelId &&
            !!session.channelId &&
            listener.channelId === session.channelId
        const guildMatches =
            !!listener.guildId &&
            !!session.guildId &&
            listener.guildId === session.guildId

        return channelMatches || guildMatches
    })
}

export function inferPlatformInfo(
    filter: { guildId?: string; channelId?: string },
    listenerGroups: Config['listenerGroups']
): {
    platform?: string
    guildId?: string
    channelId?: string
    selfId?: string
} {
    for (const listener of listenerGroups) {
        if (
            (!filter.guildId || listener.guildId === filter.guildId) &&
            (!filter.channelId || listener.channelId === filter.channelId)
        ) {
            return {
                platform: listener.platform,
                guildId: filter.guildId || listener.guildId,
                channelId: filter.channelId || listener.channelId,
                selfId: listener.selfId
            }
        }
    }
    return {}
}

export function getStartTimeByDays(days: number): Date {
    const now = new Date()
    const millisecondsPerDay = 24 * 60 * 60 * 1000
    const targetTime = now.getTime() - (days - 1) * millisecondsPerDay
    const startTime = new Date(targetTime)
    startTime.setHours(0, 0, 0, 0)
    return startTime
}

export function normalizeArray(
    value: string[] | string | '无' | undefined
): string[] {
    if (!value) return []
    if (Array.isArray(value)) return value
    if (value === '无') return []
    return value
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
}

export function preferArray(
    primary?: string[] | null,
    fallback?: string[] | null
): string[] {
    const primaryList = primary?.filter(Boolean) || []
    if (primaryList.length) return primaryList
    return fallback?.filter(Boolean) || []
}

export function finalizePersonaList(list: string[]): string[] | '无' {
    return list.length ? list : '无'
}

export function normalizePersonaText(text: string | undefined): string {
    return text ? text.replace(/\s+/g, ' ').trim() : ''
}

export function mergePersona(
    previous: UserPersonaProfile | null | undefined,
    current: UserPersonaProfile
): UserPersonaProfile {
    if (!previous) return current

    return {
        ...previous,
        ...current,
        keyTraits: preferArray(current.keyTraits, previous.keyTraits),
        interests: preferArray(current.interests, previous.interests),
        evidence: preferArray(current.evidence, previous.evidence),
        lastMergedFromHistory: true
    }
}

export async function isNapCatBot(bot: OneBotBot<Context>) {
    if (bot.platform !== 'onebot') {
        return { isRunningNapCat: false, botAppName: '' }
    }
    const onebot = bot as OneBotBot<Context>

    const versionInfo = await onebot.internal._request('get_version_info', {})

    const name = (versionInfo.data['app_name'] as string).toLowerCase()

    return { isRunningNapCat: name.includes('napcat'), botAppName: name }
}
