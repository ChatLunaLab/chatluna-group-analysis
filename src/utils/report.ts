import { GroupAnalysisResult } from '../types'

export function generateTextReport(result: GroupAnalysisResult) {
    const lines = [
        `📊 群聊分析报告 (${result.analysisDate})`,
        `群组: ${result.groupName}`,
        '',
        `总消息: ${result.totalMessages} | 参与人数: ${result.totalParticipants} | 总字数: ${result.totalChars} | 表情: ${result.emojiCount}`,
        `最活跃时段: ${result.mostActivePeriod}`,
        '',
        '💬 热门话题:'
    ]

    if (result.topics.length) {
        for (const topic of result.topics) {
            lines.push(
                `- ${topic.topic} (参与者: ${topic.contributors.join(', ')})`,
                `  ${topic.detail}`
            )
        }
    } else {
        lines.push('无明显话题')
    }

    lines.push('', '🏆 群友称号:')
    if (result.userTitles.length) {
        for (const title of result.userTitles) {
            const mbti =
                title.mbti && title.mbti !== 'N/A' ? ` (${title.mbti})` : ''
            lines.push(
                `- ${title.name}: ${title.title}${mbti} - ${title.reason}`
            )
        }
    } else {
        lines.push('无特殊称号')
    }

    lines.push('', '💬 群圣经:')
    if (result.goldenQuotes.length) {
        for (const quote of result.goldenQuotes) {
            lines.push(
                `- "${quote.content}" —— ${quote.sender}`,
                `  理由: ${quote.reason}`
            )
        }
    } else {
        lines.push('无金句记录')
    }

    return lines.join('\n')
}

export function buildGroupAnalysisCacheKey(
    selfId: string,
    target: { guildId?: string; channelId?: string },
    days: number
) {
    const targetId = target.guildId
        ? `guild:${target.guildId}`
        : `channel:${target.channelId}`
    return `${selfId}:${targetId}:${days}`
}
