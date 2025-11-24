import { GroupAnalysisResult, UserPersonaProfile, UserStats, SummaryTopic } from '../types'

/**
 * Skin renderer interface
 * Each skin must implement these methods to render different components
 */
export interface SkinRenderer {
    /**
     * Skin identifier (e.g., 'md3', 'anime')
     */
    readonly id: string

    /**
     * Human-readable skin name
     */
    readonly name: string

    /**
     * CSS selector for the main container element to screenshot
     * This is used by Puppeteer to find the element to capture
     */
    readonly containerSelector: string

    /**
     * Format user statistics list
     * @param userStats Array of user statistics
     * @returns HTML string
     */
    formatUserStats(userStats: UserStats[]): string

    /**
     * Format golden quotes section
     * @param quotes Array of golden quotes
     * @returns HTML string
     */
    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string

    /**
     * Format user titles section
     * @param userTitles Array of user titles
     * @returns HTML string
     */
    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string

    /**
     * Format topics section
     * @param topics Array of discussion topics
     * @returns HTML string
     */
    formatTopics(topics: GroupAnalysisResult['topics']): string

    /**
     * Generate active hours chart
     * @param activeHours Record mapping hour (0-23) to message count
     * @returns HTML string
     */
    generateActiveHoursChart(activeHours: Record<number, number>): string

    /**
     * Format tags for user persona (optional)
     * @param tags Array of tags
     * @returns HTML string
     */
    formatTags?(tags: string[] | undefined): string

    /**
     * Format evidence for user persona (optional)
     * @param evidence Array of evidence strings
     * @returns HTML string
     */
    formatEvidence?(evidence: UserPersonaProfile['evidence']): string
}

/**
 * Get avatar URL for a user
 * @param userId User ID (QQ number)
 * @returns Avatar URL
 */
export function getAvatarUrl(userId: number | string): string {
    return `http://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
}
