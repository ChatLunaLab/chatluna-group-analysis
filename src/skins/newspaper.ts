import { getAvatarUrl, SkinRenderer } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

/**
 * Newspaper skin renderer
 * Traditional Chinese Newspaper Style (Minguo/Vintage)
 */
export class NewspaperSkinRenderer implements SkinRenderer {
    readonly id = 'newspaper'
    readonly name = '报纸风格'
    readonly containerSelector = '.paper-container'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats || userStats.length === 0) {
            return '<div class="empty-news">暂无人物报道</div>'
        }

        return userStats
            .map(
                (user, index) => `
          <div class="news-profile">
            <div class="profile-rank">NO.${index + 1}</div>
            <div class="profile-main">
                <img src="${getAvatarUrl(user.userId)}" alt="avatar" class="profile-avatar">
                <div class="profile-info">
                    <div class="profile-name">${user.nickname}</div>
                    <div class="profile-data">
                        <span class="data-item">发言: ${user.messageCount}</span>
                        <span class="data-item">字数: ${user.charCount}</span>
                        <span class="data-item">回复率: ${(user.replyRatio * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>
          </div>
        `
            )
            .join('')
    }

    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string {
        if (!quotes || quotes.length === 0) {
            return '<div class="empty-news">本期无金句收录</div>'
        }

        return quotes
            .map(
                (quote) => `
          <div class="news-snippet">
            <div class="snippet-content">“${quote.content}”</div>
            <div class="snippet-source">
               —— ${quote.sender} <span class="snippet-comment">(${quote.reason})</span>
            </div>
          </div>
        `
            )
            .join('')
    }

    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string {
        if (!userTitles || userTitles.length === 0) {
            return '<div class="empty-news">本期无特殊称号</div>'
        }

        return userTitles
            .map(
                (title) => `
          <div class="title-item">
            <div class="title-header">
                <span class="title-name">${title.name}</span>
                <span class="title-badge">${title.title}</span>
            </div>
            <div class="title-desc">${title.reason}</div>
            ${title.mbti && title.mbti !== 'N/A' ? `<div class="title-mbti">MBTI: ${title.mbti}</div>` : ''}
          </div>
        `
            )
            .join('')
    }

    formatTopics(topics: GroupAnalysisResult['topics']): string {
        if (!topics || topics.length === 0) {
            return '<div class="empty-news">本期无重大新闻</div>'
        }

        return topics
            .map(
                (topic) => `
             <div class="news-article">
               <h3 class="article-title">${topic.topic}</h3>
               <div class="article-meta">参与者: ${topic.contributors.join(', ')}</div>
               <div class="article-body">${topic.detail}</div>
             </div>
           `
            )
            .join('')
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        const values = Object.values(activeHours)
        const maxCount = values.length > 0 ? Math.max(...values) : 0
        const chartBars: string[] = []

        // The container height
        const maxBarHeight = 150

        for (let i = 0; i < 24; i++) {
            const count = activeHours[i] || 0
            let barHeight = maxCount > 0 ? (count / maxCount) * maxBarHeight : 0
            if (count > 0 && barHeight < 2) {
                barHeight = 2 // Min height
            }

            const percentage =
                maxCount > 0 ? Math.round((count / maxCount) * 100) : 0

            const barStyle =
                barHeight > 0
                    ? `style="height: ${barHeight}px !important;"`
                    : `style="height: 0px !important;"`

            chartBars.push(`
                    <div class="chart-col" title="${i}:00 - ${count} 条 (${percentage}%)">
                        <div class="chart-bar" ${barStyle}></div>
                        <span class="chart-axis">${i}</span>
                    </div>
                `)
        }

        return `
                <div class="news-chart">
                    ${chartBars.join('')}
                </div>
            `
    }

    formatTags(tags: string[] | undefined): string {
        if (!tags || tags.length === 0) {
            return ''
        }

        return tags
            .map((tag) => `<span class="news-tag">${tag}</span>`)
            .join('')
    }

    formatEvidence(items: string[] | '无' | undefined): string {
        if (!items || items.length === 0 || items === '无') {
            return '<div class="empty-news">暂无依据</div>'
        }

        const listItems = items
            .map((item) => {
                const quoteHtml = (item || '')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .join('<br/>')
                return `
                    <li class="evidence-line">
                        ${quoteHtml}
                    </li>
                `
            })
            .join('')
        return `<ul class="evidence-list">${listItems}</ul>`
    }
}
