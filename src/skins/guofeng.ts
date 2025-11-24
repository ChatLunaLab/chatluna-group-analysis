import { SkinRenderer, getAvatarUrl } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Guofeng skin renderer
 * Traditional Chinese style interface
 */
export class GuofengSkinRenderer implements SkinRenderer {
    readonly id = 'guofeng'
    readonly name = '国风雅韵'
    readonly containerSelector = '.game-window'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats || userStats.length === 0) {
            return '<div class="empty-state">暂无用户统计信息</div>'
        }

        return userStats
            .map(
                (user) => `
          <div class="char-card">
            <img src="${getAvatarUrl(user.userId)}" alt="avatar" class="char-avatar">
            <div class="char-info">
              <div class="char-name">${user.nickname}</div>
              <div class="char-stats">
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

    formatGoldenQuotes(
        quotes: GroupAnalysisResult['goldenQuotes']
    ): string {
        if (!quotes || quotes.length === 0) {
            return '<div class="empty-state">本次未发现逆天神人发言</div>'
        }

        return quotes
            .map(
                (quote) => `
          <div class="dialogue-box quote-box">
            <div class="quote-text">"${quote.content}"</div>
            <div class="dialogue-meta">
               — ${quote.sender} (评: ${quote.reason})
            </div>
          </div>
        `
            )
            .join('')
    }

    formatUserTitles(
        userTitles: GroupAnalysisResult['userTitles']
    ): string {
        if (!userTitles || userTitles.length === 0) {
            return '<div class="empty-state">本次无人获得特殊称号</div>'
        }

        return userTitles
            .map(
                (title) => `
          <div class="char-card">
            <img src="${getAvatarUrl(title.id)}" alt="avatar" class="char-avatar">
            <div class="char-info">
              <div class="char-name">${title.name}</div>
              <div class="title-badge">${title.mbti && title.mbti !== 'N/A' ? `${title.title} | ${title.mbti}` : title.title}</div>
              <div class="char-stats" style="grid-template-columns: 1fr;">
                <span>${title.reason}</span>
              </div>
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
             <div class="dialogue-box">
               <div class="dialogue-header">${topic.topic}</div>
               <div class="dialogue-text">${topic.detail}</div>
               <div class="dialogue-meta">参与者: ${topic.contributors.join(', ')}</div>
             </div>
           `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []

        // The container `.chart-container` is 250px tall.
        const maxBarHeight = 200

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * maxBarHeight : 0
            if (count > 0 && barHeight < 3) {
                barHeight = 3 // 最小可见高度
            }

            const percentage =
                maxCount > 0 ? Math.round((count / maxCount) * 100) : 0

            const barStyle =
                barHeight > 0
                    ? `style="height: ${barHeight}px !important;"`
                    : `style="height: 0px !important;"`

            chartBars.push(`
                    <div class="chart-bar-wrapper" title="${i}:00 - ${count} 条消息 (${percentage}%)">
                        <div class="chart-bar" ${barStyle}></div>
                        <span class="chart-label">${String(i).padStart(2, '0')}</span>
                    </div>
                `)
        }

        return `
                <div class="chart-container">
                    ${chartBars.join('')}
                </div>
            `
    }

    formatTags(tags: string[] | undefined): string {
        if (!tags || tags.length === 0) {
            return '<div class="empty-state">暂无数据</div>'
        }

        return tags
            .map((tag) => `<span class="game-tag">${tag}</span>`)
            .join('')
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
                    <li class="evidence-item">
                        <div class="evidence-quote">${quoteHtml}</div>
                    </li>
                `
            })
            .join('')
        return `<ul class="evidence-list">${listItems}</ul>`
    }
}
