import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Art Style Skin Renderer
 * A minimal, high-end, artistic line style skin
 */
export class ArtSkinRenderer implements SkinRenderer {
    readonly id = 'art'
    readonly name = 'Art Style'
    readonly containerSelector = '.container'

    formatUserStats(userStats: UserStats[]): string {
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
            <span>发言: <strong>${user.messageCount}</strong></span>
            <span>字数: <strong>${user.charCount}</strong></span>
            <span>回复: <strong>${(user.replyRatio * 100).toFixed(0)}%</strong></span>
            <span>夜猫: <strong>${(user.nightRatio * 100).toFixed(0)}%</strong></span>
          </div>
        </div>
      </div>
    `
            )
            .join('')
    }

    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string {
        if (!quotes || quotes.length === 0) {
            return '<div class="empty-state">本次未发现逆天神人发言</div>'
        }

        return quotes
            .map(
                (quote) => `
      <div class="quote-card">
        <div class="quote-content">${quote.content}</div>
        <div class="quote-footer">
          <div class="quote-sender">— ${quote.sender}</div>
          <div class="quote-reason">${quote.reason}</div>
        </div>
      </div>
    `
            )
            .join('')
    }

    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string {
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

    formatTopics(topics: GroupAnalysisResult['topics']): string {
        if (!topics || topics.length === 0) {
            return '<div class="empty-state">本次无明显讨论话题</div>'
        }

        return topics
            .map(
                (topic) => `
         <div class="topic-card">
           <div class="topic-title">${topic.topic}</div>
           <div class="topic-contributors">CONTRIBUTORS: ${topic.contributors.join(', ')}</div>
           <p class="topic-detail">${topic.detail}</p>
         </div>
       `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []

        // The container `.activity-bar` is effective 180px tall (200px - 20px padding).
        // Label approx 20px, Count approx 20px.
        // Max bar height approx 140px to be safe.
        const maxBarHeight = 140

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * maxBarHeight : 0
            if (count > 0 && barHeight < 2) {
                barHeight = 2 // Min visible height
            }

            const percentage =
                maxCount > 0 ? Math.round((count / maxCount) * 100) : 0

            const barStyle =
                barHeight > 0
                    ? `style="height: ${barHeight}px !important;"`
                    : `style="height: 0px !important;"`

            chartBars.push(`
                <div class="activity-bar" title="${i}:00 - ${count} messages (${percentage}%)">
                    <div class="activity-bar-count">${count > 0 ? count : ''}</div>
                    <div class="activity-bar-bar" ${barStyle}></div>
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
                    24H ACTIVITY DISTRIBUTION (PEAK: ${maxCount})
                </div>
            </div>
        `
    }

    formatTags(tags: string[] | undefined): string {
        if (!tags || tags.length === 0) {
            return '<div class="empty-state">暂无数据</div>'
        }

        return tags.map((tag) => `<div class="chip">${tag}</div>`).join('')
    }

    formatEvidence(items: string[] | '无' | undefined): string {
        if (!items || items.length === 0 || items === '无') {
            return '<div class="empty-state">暂无事实依据</div>'
        }

        const cards = items
            .map((item) => {
                const quoteHtml = (item || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .join('<br/>')
                return `
                    <div class="card outlined-card evidence-card">
                        <p>${quoteHtml}</p>
                    </div>
                `
            })
            .join('')

        return `<div class="card-grid">${cards}</div>`
    }
}
