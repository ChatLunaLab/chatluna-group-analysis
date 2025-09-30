import { h } from 'koishi'

import {
    BasicStatsResult,
    GroupAnalysisResult,
    SummaryTopic,
    UserStats
} from './types'
import { StoredMessage } from './service/message'
import { Config } from './config'

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
        stat.charCount += msg.content.length
        stat.lastActive = new Date(
            Math.max(stat.lastActive.getTime(), msg.timestamp.getTime())
        )
        totalChars += msg.content.length

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
            } else if (el.type === 'quote') {
                stat.replyCount++
            } else if (el.type === 'at') {
                stat.atCount++
            } else if (el.type === 'face') {
                stat.emojiStats['face'] = (stat.emojiStats['face'] || 0) + 1
                totalEmojiCount++
            } else if (el.type === 'image' && el.attrs.type === 'sticker') {
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
    }

    return { userStats, totalChars, totalEmojiCount, allMessagesText }
}

function getInitialUserStats(msg: StoredMessage): UserStats {
    return {
        userId: String(msg.userId),
        nickname: msg.username,
        messageCount: 0,
        charCount: 0,
        lastActive: new Date(0),
        replyCount: 0,
        atCount: 0,
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

export function formatUserStats(userStats: UserStats[]): string {
    if (!userStats || userStats.length === 0) {
        return '<div class="empty-state">暂无用户统计信息</div>'
    }
    return userStats
        .map(
            (user) => `
      <div class="user-stat-card">
        <img src="${getAvatarUrl(user.userId)}" alt="avatar" class="avatar">
        <div class="user-details">
          <div class="nickname">${user.nickname}</div>
          <div class="stats-grid">
            <span>发言数: <strong>${user.messageCount}</strong></span>
            <span>字数: <strong>${user.charCount}</strong></span>
            <span>回复率: <strong>${(user.replyRatio * 100).toFixed(0)}%</strong></span>
            <span>夜猫子: <strong>${(user.nightRatio * 100).toFixed(0)}%</strong></span>
          </div>
        </div>
      </div>
    `
        )
        .join('')
}

export function formatGoldenQuotes(
    quotes: GroupAnalysisResult['goldenQuotes']
): string {
    if (!quotes || quotes.length === 0) {
        return '<div class="empty-state">本次未发现逆天神人发言</div>'
    }
    return quotes
        .map(
            (quote) => `
      <div class="quote-card">
        <div class="quote-content">“${quote.content}”</div>
        <div class="quote-footer">
          <span class="quote-sender">— ${quote.sender}</span>
          <p class="quote-reason"><strong>逆天理由:</strong> ${quote.reason}</p>
        </div>
      </div>
    `
        )
        .join('')
}

export function formatUserTitles(
    userTitles: GroupAnalysisResult['userTitles']
): string {
    if (!userTitles || userTitles.length === 0) {
        return '<div class="empty-state">本次无人获得特殊称号</div>'
    }
    return userTitles
        .map(
            (title) => `
      <div class="title-card">
        <img src="${getAvatarUrl(title.id)}" alt="avatar" class="avatar">
        <div class="title-details">
          <div class="nickname">${title.name}</div>
          <div class="title-badge">${title.mbti && title.mbti !== 'N/A' ? `${title.title} | ${title.mbti}` : title.title}</div>
          <p class="title-reason">${title.reason}</p>
        </div>
      </div>
    `
        )
        .join('')
}

export function formatTopics(topics: GroupAnalysisResult['topics']): string {
    if (!topics || topics.length === 0) {
        return '<div class="empty-state">本次无明显讨论话题</div>'
    }
    return topics
        .map(
            (topic: SummaryTopic) => `
         <div class="topic-card">
           <div class="topic-title">${topic.topic}</div>
           <div class="topic-contributors">主要参与者: ${topic.contributors.join(', ')}</div>
           <p class="topic-detail">${topic.detail}</p>
         </div>
       `
        )
        .join('')
}

export function generateActiveHoursChart(
    activeHours: Record<number, number>
): string {
    const values = Object.values(activeHours)
    const maxCount = values.length > 0 ? Math.max(...values) : 0
    const chartBars: string[] = []

    for (let i = 0; i < 24; i++) {
        const count = activeHours[i] || 0
        const height = maxCount > 0 ? (count / maxCount) * 100 : 0
        const percentage =
            maxCount > 0 ? Math.round((count / maxCount) * 100) : 0

        chartBars.push(`
                <div class="activity-bar" title="${i}:00 - ${count} ����Ϣ (${percentage}%)">
                    <div class="activity-bar-bar" style="height: ${height}%;"></div>
                    <span class="activity-bar-label">${String(i).padStart(2, '0')}</span>
                </div>
            `)
    }

    return `
            <div class="activity-chart-container">
                <div class="activity-chart">
                    ${chartBars.join('')}
                </div>
                <div class="chart-legend">
                    <span class="legend-text">24Сʱ��Ծ�ȷֲ� (���: ${maxCount} ����Ϣ)</span>
                </div>
            </div>
        `
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
    }[]
): boolean {
    if (!session.guildId && !session.channelId) return false

    return listenerGroups.some((listener) => {
        return (
            listener.enabled &&
            listener.platform === session.platform &&
            listener.selfId === session.selfId &&
            listener.channelId === session.channelId &&
            (!listener.guildId || listener.guildId === session.guildId)
        )
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
