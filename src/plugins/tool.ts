/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { parseDate } from 'chrono-node'
import { Context, Session } from 'koishi'
import { array, z } from 'zod'
import { Config } from '../config'
import type { GroupMessageFetchFilter, MessageFilter } from '../types'

export const inject = {
    chatluna_group_analysis: {
        required: true
    },
    chatluna_group_analysis_message: {
        required: true
    }
}

export function apply(ctx: Context, config: Config) {
    const plugin = new ChatLunaPlugin(
        ctx,
        config as unknown as ChatLunaPlugin.Config,
        'chatluna-group-analysis',
        false
    )

    ctx.on('ready', () => {

        if (!config.registerTools) {
            return
        }

        plugin.registerTool('group_message_fetch', {
            selector() {
                return true
            },
            createTool() {
                return new GroupMessageFetchTool(ctx)
            }
        })

        plugin.registerTool('group_user_persona', {
            selector() {
                return true
            },
            createTool() {
                return new GroupUserPersonaTool(ctx)
            }
        })
    })
}

type GroupMessageFetchInput = z.infer<typeof groupMessageFetchSchema>

class GroupMessageFetchTool extends StructuredTool {
    name = 'group_message_fetch'

    schema = groupMessageFetchSchema

    description =
        'Fetch historical messages for the current group or a specified scope. Provide natural English expressions for startTime/endTime such as "1 hour ago", "yesterday", or "now". The result contains the matching messages in JSON format.'

    constructor(private readonly ctx: Context) {
        super({})
    }

    async _call(
        input: GroupMessageFetchInput,
        _runManager: unknown,
        runnable: ChatLunaToolRunnable
    ) {
        const session = runnable.configurable.session
        if (!session) {
            return 'Session context is unavailable; cannot fetch group messages.'
        }

        try {
            const rawFilter = input.filter ?? {}
            const filter = this.buildFilter(rawFilter, session)

            if (!filter.guildId && !filter.channelId) {
                filter.guildId = session.guildId
                filter.channelId = session.channelId
            }

            const messages =
                await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    filter
                )

            if (!messages.length) {
                return 'No historical messages matched the provided filter.'
            }

            const response = {
                count: messages.length,
                filter: {
                    guildId: filter.guildId,
                    channelId: filter.channelId,
                    userId: filter.userId ? String(filter.userId) : undefined,
                    selfId: filter.selfId,
                    startTime: filter.startTime?.toISOString(),
                    endTime: filter.endTime?.toISOString(),
                    limit: filter.limit,
                    offset: filter.offset
                },
                messages: messages.map((message) => ({
                    id: message.id,
                    guildId: message.guildId,
                    channelId: message.channelId,
                    userId: message.userId,
                    username: message.username,
                    timestamp: message.timestamp.toISOString(),
                    content: message.content
                }))
            }

            return JSON.stringify(response, null, 2)
        } catch (error) {
            const reason =
                error instanceof Error
                    ? error.message
                    : 'Unknown error while fetching messages.'
            return `Failed to fetch historical messages: ${reason}`
        }
    }

    private buildFilter(raw: GroupMessageFetchFilter, session: Session): MessageFilter {
        const filter: MessageFilter = {
            guildId: raw.guildId ?? session.guildId,
            channelId: raw.channelId ?? session.channelId,
            userId: raw.userId,
            selfId: session.selfId,
            limit: raw.limit,
            offset: raw.offset
        }

        const startTime = this.parseNaturalLanguageTime(raw.startTime)
        const endTime = this.parseNaturalLanguageTime(raw.endTime)

        if (startTime) filter.startTime = startTime
        if (endTime) filter.endTime = endTime

        if (filter.startTime && filter.endTime && filter.startTime > filter.endTime) {
            throw new Error('startTime must be earlier than endTime.')
        }

        if (filter.limit && filter.limit > MAX_FETCH_LIMIT) {
            filter.limit = MAX_FETCH_LIMIT
        }

        return filter
    }

    private parseNaturalLanguageTime(value?: string) {
        if (!value) return undefined

        const trimmed = value.trim()
        if (!trimmed) return undefined

        const parsed = parseDate(trimmed, new Date())
        if (!parsed) {
            throw new Error(
                `Unable to understand "${value}". Please use natural English expressions like "15 minutes ago" or "yesterday 18:00".`
            )
        }

        return parsed
    }
}


const MAX_FETCH_LIMIT = 500

const groupMessageFilterSchema = z
    .object({
        userId: z
            .array(z.string())
            .min(1)
            .optional()
            .describe('Only return messages sent by the specified user ID array.'),

        startTime: z
            .string()
            .min(1)
            .optional()
            .describe(
                'Start time expressed in natural English (e.g., "2 hours ago", "yesterday 8pm").'
            ),
        endTime: z
            .string()
            .min(1)
            .optional()
            .describe(
                'End time expressed in natural English (e.g., "now", "10 minutes ago").'
            ),
        limit: z
            .number()
            .int()
            .positive()
            .max(MAX_FETCH_LIMIT)
            .optional()
            .describe(
                `Maximum number of messages to retrieve (1-${MAX_FETCH_LIMIT}). Defaults to the service setting.`
            ),
        offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Offset for pagination when reading from the persisted database store.')
    })
    .describe(
        'Filter options copied from the service definitions. Start and end time must use natural English phrases instead of raw timestamps.'
    )

const groupMessageFetchSchema = z.object({
    filter: groupMessageFilterSchema.optional().default({})
})

const groupUserPersonaSchema = z.object({
    user_id: z
        .string()
        .min(1)
        .describe('The target user ID whose persona should be retrieved.')
})


type GroupUserPersonaInput = z.infer<typeof groupUserPersonaSchema>

class GroupUserPersonaTool extends StructuredTool {
    name = 'group_user_persona'

    schema = groupUserPersonaSchema

    description =
        'Retrieve the stored persona profile for a specific user ID within the current bot instance.'

    constructor(private readonly ctx: Context) {
        super({})
    }

    async _call(
        input: GroupUserPersonaInput,
        _runManager: unknown,
        runnable: ChatLunaToolRunnable
    ) {
        const session = runnable.configurable.session as Session | undefined
        if (!session) {
            return 'Session context is unavailable; cannot look up user persona.'
        }

        const userId = input.user_id

        try {
            const result = await this.ctx.chatluna_group_analysis.getUserPersona(
                session.platform,
                session.selfId,
                userId
            )

            if (!result) {
                return `No persona profile found for user ${userId}.`
            }

            const { profile, username } = result

            const persona = {
                userId: profile.userId,
                username,
                summary: profile.summary,
                keyTraits: profile.keyTraits,
                interests: profile.interests,
                communicationStyle: profile.communicationStyle,
                evidence: profile.evidence,
                lastMergedFromHistory: profile.lastMergedFromHistory ?? false
            }

            return JSON.stringify(persona, null, 2)
        } catch (error) {
            const reason =
                error instanceof Error
                    ? error.message
                    : 'Unknown error while retrieving persona.'
            return `Failed to retrieve user persona: ${reason}`
        }
    }
}

