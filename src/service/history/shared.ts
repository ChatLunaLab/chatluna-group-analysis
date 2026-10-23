import { Config } from '../../config'
import { MessageFilter, StoredMessage } from '../../types'

export function filterHistoryMessages(
    messages: StoredMessage[],
    filter: MessageFilter,
    config: Config
) {
    return messages.filter((message) => {
        if (filter.startTime && message.timestamp < filter.startTime)
            return false
        if (filter.endTime && message.timestamp > filter.endTime) return false
        if (
            filter.userId &&
            filter.userId.length &&
            !filter.userId.includes(message.userId)
        )
            return false
        if (config.wordsFilter.some((word) => message.content.includes(word)))
            return false
        if (filter.purpose === 'group-analysis')
            return !config.userFilter.includes(message.userId)
        if (filter.purpose === 'user-persona')
            return !config.personaUserFilter.includes(message.userId)
        return true
    })
}

export function sortHistoryMessages(
    messages: StoredMessage[],
    filter: MessageFilter
) {
    return messages
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        .slice(0, filter.limit)
}
