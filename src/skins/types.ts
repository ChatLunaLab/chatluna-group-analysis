import type {
    GroupAnalysisResult,
    UserPersonaProfile,
    UserStats
} from '../types'

export interface SkinRenderer {
    readonly id: string
    readonly name: string
    readonly containerSelector: string

    formatUserStats(userStats: UserStats[]): string
    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string
    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string
    formatTopics(topics: GroupAnalysisResult['topics']): string
    generateActiveHoursChart(activeHours: Record<number, number>): string
    formatTags(tags: string[] | undefined): string
    formatEvidence(evidence: UserPersonaProfile['evidence']): string
}

export { getAvatarUrl } from '../utils/message'
