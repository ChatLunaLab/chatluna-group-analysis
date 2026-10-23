import { h } from 'koishi'
import { StoredMessage, UserPersonaProfile } from '../types'

export function buildPersonaRecordId(
    platform: string,
    selfId: string,
    userId: string | number
) {
    return `${platform}:${selfId}:${userId}`
}

export function formatMessagesForPersona(messages: StoredMessage[]) {
    return messages
        .map((message) => {
            const time = message.timestamp
                .toISOString()
                .replace('T', ' ')
                .slice(0, 16)
            const scope = message.guildId
                ? `群:${message.guildId}`
                : `频道:${message.channelId}`
            const elements = message.elements || h.parse(message.content)
            const content = h
                .select(elements, 'text')
                .map((text) => text.attrs.content)
                .join('')
                .replace(/\s+/g, ' ')
                .trim()
            return `[${time}] ${scope} ${message.username}: ${content}`
        })
        .join('\n')
}

export function formatPersonaForPrompt(persona?: UserPersonaProfile | null) {
    if (!persona) return '（无历史画像）'

    const lines = [
        `summary: ${persona.summary || '无'}`,
        `keyTraits: ${(persona.keyTraits || []).join('; ') || '无'}`,
        `interests: ${(persona.interests || []).join('; ') || '无'}`,
        `communicationStyle: ${persona.communicationStyle || '未知'}`
    ]

    if (!persona.evidence || !persona.evidence.length) {
        lines.push('evidence: 无')
    } else {
        lines.push('evidence:')
        for (const item of persona.evidence)
            lines.push(`    quote: ${item || '（空）'}`)
    }
    return lines.join('\n')
}

export function mergePersona(
    previous: UserPersonaProfile | null | undefined,
    current: UserPersonaProfile
): UserPersonaProfile {
    if (!previous) return current

    return {
        ...previous,
        ...current,
        keyTraits: preferArray(current.keyTraits, previous.keyTraits),
        interests: preferArray(current.interests, previous.interests),
        evidence: preferArray(current.evidence, previous.evidence),
        lastMergedFromHistory: true
    }
}

function preferArray(primary?: string[] | null, fallback?: string[] | null) {
    const values = primary ? primary.filter(Boolean) : []
    if (values.length) return values
    return fallback ? fallback.filter(Boolean) : []
}
