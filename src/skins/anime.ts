import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Anime skin renderer (Updated 2.0)
 * Supports new Glassmorphism/Pop layout and Night Mode
 */
export class AnimeSkinRenderer implements SkinRenderer {
    readonly id = 'anime'
    readonly name = '二次元风格'
    readonly containerSelector = '.anime-window'

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
          <div class="dialogue-bubble">
            <div class="dialogue-content">"${quote.content}"</div>
            <div class="dialogue-author">
               ${quote.sender}
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
          <div class="char-card">
            <img src="${getAvatarUrl(title.id)}" alt="avatar" class="char-avatar">
            <div class="char-info">
              <div class="char-name">${title.name}</div>
              <div class="char-tags">
                 <span class="mini-tag">${title.title}</span>
                 ${title.mbti && title.mbti !== 'N/A' ? `<span class="mini-tag">${title.mbti}</span>` : ''}
              </div>
              <div class="char-stats" style="margin-top: 4px;">
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
             <div class="dialogue-bubble">
               <div class="char-name" style="font-size: 16px; margin-bottom: 4px;">${topic.topic}</div>
               <div class="dialogue-content" style="font-size: 14px;">${topic.detail}</div>
               <div class="dialogue-author">参与者: ${topic.contributors.join(', ')}</div>
             </div>
           `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []
        const maxBarHeightPercent = 100; // CSS height is percentage based effectively in flex

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * 100 : 0
            if (count > 0 && barHeight < 5) {
                barHeight = 5 // Min height visibility
            }
            
            const percentage = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0

            chartBars.push(`
                    <div class="bar-group" title="${i}:00 - ${count} 条消息">
                        <div class="bar-fill" style="height: ${barHeight}%;"></div>
                        <span class="bar-label">${String(i).padStart(2, '0')}</span>
                    </div>
                `)
        }

        return `
                <div class="chart-box">
                    ${chartBars.join('')}
                </div>
            `
    }

    formatTags(tags: string[] | undefined): string {
        if (!tags || tags.length === 0) {
            return '<div class="empty-state">暂无数据</div>'
        }

        return tags
            .map((tag) => `<span class="tag-pill">${tag}</span>`)
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
                    <li class="evidence-card">
                        ${quoteHtml}
                    </li>
                `
            })
            .join('')
        return `<ul class="evidence-list">${listItems}</ul>`
    }
}