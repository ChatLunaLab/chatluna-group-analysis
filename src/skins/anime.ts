import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Anime skin renderer with a soft pastel keepsake aesthetic.
 * All decorative artwork is drawn with CSS; no character art is used.
 */
export class AnimeSkinRenderer implements SkinRenderer {
    readonly id = 'anime'
    readonly name = '二次元风格'
    readonly containerSelector = '.anime-container'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats || userStats.length === 0) {
            return '<div class="empty-state">暂无用户统计信息</div>'
        }

        return userStats
            .map(
                (user, index) => `
          <div class="char-box user-stat-card">
            <span class="char-rank">第 ${index + 1} 名</span>
            <img src="${getAvatarUrl(user.userId)}" alt="${user.nickname} 的头像" class="char-avatar">
            <div class="char-content">
              <div class="char-name">${user.nickname}</div>
              <div class="char-detail">
                <span>发言 <strong>${user.messageCount}</strong></span>
                <span>回复 <strong>${(user.replyRatio * 100).toFixed(0)}%</strong></span>
                <span>字数 <strong>${user.charCount}</strong></span>
                <span>夜猫 <strong>${(user.nightRatio * 100).toFixed(0)}%</strong></span>
              </div>
            </div>
          </div>
        `
            )
            .join('')
    }

    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string {
        if (!quotes || quotes.length === 0) {
            return '<div class="empty-state">本次没有发现值得收藏的发言</div>'
        }

        return quotes
            .map(
                (quote) => `
          <div class="bubble quote-card">
            <span class="quote-mark" aria-hidden="true">“</span>
            <div class="bubble-text">${quote.content}</div>
            <div class="bubble-meta">
              <span class="quote-sender">${quote.sender}</span>
            </div>
            ${quote.reason ? `<div class="quote-reason">收藏理由：${quote.reason}</div>` : ''}
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
          <div class="char-box title-card">
            <img src="${getAvatarUrl(title.id)}" alt="${title.name} 的头像" class="char-avatar">
            <div class="char-content">
              <div class="char-name">${title.name}</div>
              <div class="char-badges">
                <span class="char-badge">${title.title}</span>
                ${title.mbti && title.mbti !== 'N/A' ? `<span class="char-badge mbti-badge">${title.mbti}</span>` : ''}
              </div>
              <div class="char-reason">${title.reason}</div>
            </div>
          </div>
        `
            )
            .join('')
    }

    formatTopics(topics: GroupAnalysisResult['topics']): string {
        if (!topics || topics.length === 0) {
            return '<div class="empty-state">本次没有明显的讨论话题</div>'
        }

        return topics
            .map(
                (topic) => `
          <div class="bubble topic-card">
            <div class="topic-title">${topic.topic}</div>
            <div class="topic-detail">${topic.detail}</div>
            <div class="bubble-meta">参与讨论：${topic.contributors.join('、')}</div>
          </div>
        `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []
        let peakRendered = false

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * 100 : 0
            if (count > 0 && barHeight < 10) {
                barHeight = 10
            }

            const isPeak = count > 0 && count === maxCount && !peakRendered
            if (isPeak) {
                peakRendered = true
            }

            chartBars.push(`
                <div class="chart-bar-group" title="${i} 时：${count} 条消息">
                    <div class="chart-bar-track">
                        ${isPeak ? `<span class="chart-value">${count}</span>` : ''}
                        <div class="chart-bar${isPeak ? ' is-peak' : ''}" style="height: ${barHeight}%;"></div>
                    </div>
                    <span class="chart-label">${i % 2 === 0 ? String(i).padStart(2, '0') : ''}</span>
                </div>
            `)
        }

        return `
            <div class="chart-panel">
                <div class="chart-caption">
                    <span>每小时消息数</span>
                    <span>最高 <strong>${maxCount}</strong> 条</span>
                </div>
                <div class="chart-container">${chartBars.join('')}</div>
            </div>
        `
    }

    formatTags(tags: string[] | undefined): string {
        if (!tags || tags.length === 0) {
            return '<div class="empty-state">暂无数据</div>'
        }

        return tags.map((tag) => `<span class="tag">${tag}</span>`).join('')
    }

    formatEvidence(items: string[] | '无' | undefined): string {
        if (!items || items.length === 0 || items === '无') {
            return '<div class="empty-state">暂无事实依据</div>'
        }

        const listItems = items
            .map((item) => {
                const quoteHtml = (item || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .join('<br/>')
                return `
                    <div class="evidence-item">
                        <span class="evidence-mark" aria-hidden="true">✎</span>
                        <div>${quoteHtml}</div>
                    </div>
                `
            })
            .join('')
        return `<div class="evidence-list">${listItems}</div>`
    }
}
