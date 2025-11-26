import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Anime skin renderer (Updated to Nahida/Sumeru Style 3.0)
 * Cute, 2D-first, Sticker/Card aesthetics.
 */
export class AnimeSkinRenderer implements SkinRenderer {
    readonly id = 'anime'
    readonly name = '二次元风格'
    readonly containerSelector = '.nahida-container'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats || userStats.length === 0) {
            return '<div class="empty-state">暂无用户统计信息</div>'
        }

        return userStats
            .map(
                (user) => `
          <div class="char-box">
            <img src="${getAvatarUrl(user.userId)}" alt="avatar" class="char-avatar">
            <div class="char-content">
              <div class="char-name">${user.nickname}</div>
              <div class="char-detail">
                <span>发言: <strong>${user.messageCount}</strong></span>
                <span>回复: <strong>${(user.replyRatio * 100).toFixed(0)}%</strong></span>
                <span>字数: <strong>${user.charCount}</strong></span>
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
          <div class="bubble">
            <div class="bubble-text">"${quote.content}"</div>
            <div class="bubble-meta">
               — ${quote.sender}
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
          <div class="char-box">
            <img src="${getAvatarUrl(title.id)}" alt="avatar" class="char-avatar">
            <div class="char-content">
              <div class="char-name">${title.name}</div>
              <div style="margin-bottom: 6px;">
                 <span class="char-badge">${title.title}</span>
                 ${title.mbti && title.mbti !== 'N/A' ? `<span class="char-badge" style="background:#E1BEE7;">${title.mbti}</span>` : ''}
              </div>
              <div class="char-detail" style="font-style:italic;">
                ${title.reason}
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
             <div class="bubble">
               <div style="font-weight:bold; color:var(--color-primary); margin-bottom:4px; font-size:18px;"># ${topic.topic}</div>
               <div class="bubble-text" style="font-size: 14px;">${topic.detail}</div>
               <div class="bubble-meta">参与者: ${topic.contributors.join(', ')}</div>
             </div>
           `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * 100 : 0
            if (count > 0 && barHeight < 10) {
                barHeight = 10 // Min height for visibility
            }
            
            chartBars.push(`
                    <div class="chart-bar-group" title="${i}:00 - ${count} 条消息">
                        <div class="chart-bar" style="height: ${barHeight}%;"></div>
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
            .map((tag) => `<span class="tag">${tag}</span>`)
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
                    <div class="evidence-item">
                        ${quoteHtml}
                    </div>
                `
            })
            .join('')
        return `<div>${listItems}</div>`
    }
}
