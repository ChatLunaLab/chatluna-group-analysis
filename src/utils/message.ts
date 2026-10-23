import { Config } from '../config'
import { StoredMessage } from '../types'

export interface MessageScope {
    guildId?: string
    channelId?: string
    platform: string
    selfId: string
}

export function getAvatarUrl(userId: number | string) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
}

export function matchesGroupListener(
    session: MessageScope,
    listener: Config['listenerGroups'][number]
) {
    if (
        !listener.enabled ||
        listener.platform !== session.platform ||
        listener.selfId !== session.selfId
    ) {
        return false
    }

    return !!(
        (listener.channelId && listener.channelId === session.channelId) ||
        (listener.guildId && listener.guildId === session.guildId)
    )
}

export function shouldListenToMessage(
    session: MessageScope,
    listenerGroups: Config['listenerGroups'],
    enableAllGroupsByDefault = false
) {
    if (!session.guildId && !session.channelId) return false
    return (
        enableAllGroupsByDefault ||
        listenerGroups.some((listener) =>
            matchesGroupListener(session, listener)
        )
    )
}

export function buildMessagePersistenceKey(message: StoredMessage) {
    const scope = message.guildId || message.channelId || 'global'
    return `${message.platform}_${message.selfId}_${scope}`
}
