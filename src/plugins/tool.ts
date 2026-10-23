import { StructuredTool } from '@langchain/core/tools'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { parseDate } from 'chrono-node'
import { Context, Session } from 'koishi'
import { z } from 'zod'
import { Config } from '../config'
import { MessageFilter } from '../types'

export const inject = {
    chatluna_group_analysis: { required: true },
    chatluna_group_analysis_message: { required: true }
}

export function apply(ctx: Context, config: Config) {
    if (!config.registerTools) return
    const plugin = new ChatLunaPlugin(
        ctx,
        config as unknown as ChatLunaPlugin.Config,
        'chatluna-group-analysis',
        false
    )

    ctx.on('ready', () => {
        plugin.registerTool('group_message_fetch', {
            selector: () => true,
            createTool: () => new GroupMessageFetchTool(ctx)
        })
        plugin.registerTool('group_user_persona', {
            selector: () => true,
            createTool: () => new GroupUserPersonaTool(ctx, config)
        })
    })
}

class GroupMessageFetchTool extends StructuredTool {
    name = 'group_message_fetch'
    schema = groupMessageFetchSchema
    description =
        'Fetch historical messages for the current group. Use natural English for startTime/endTime, such as "1 hour ago", "yesterday", or "now".'

    constructor(private ctx: Context) {
        super({})
    }

    async _call(
        input: z.infer<typeof groupMessageFetchSchema>,
        _runManager: unknown,
        runnable: ChatLunaToolRunnable
    ) {
        const session = runnable.configurable.session
        if (!session)
            return 'Session context is unavailable; cannot fetch group messages.'

        try {
            const filter = this.buildFilter(input.filter || {}, session)
            if (!filter.guildId && !filter.channelId)
                return 'No group is associated with this session.'

            const messages =
                await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    filter
                )
            if (!messages.length)
                return 'No historical messages matched the provided filter.'

            return JSON.stringify(
                {
                    count: messages.length,
                    filter: {
                        guildId: filter.guildId,
                        channelId: filter.channelId,
                        userId: filter.userId
                            ? String(filter.userId)
                            : undefined,
                        selfId: filter.selfId,
                        startTime:
                            filter.startTime && filter.startTime.toISOString(),
                        endTime: filter.endTime && filter.endTime.toISOString(),
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
                },
                null,
                2
            )
        } catch (error) {
            const reason =
                error instanceof Error
                    ? error.message
                    : 'Unknown error while fetching messages.'
            return `Failed to fetch historical messages: ${reason}`
        }
    }

    private buildFilter(
        raw: z.infer<typeof groupMessageFilterSchema>,
        session: Session
    ): MessageFilter {
        const filter: MessageFilter = {
            guildId: session.guildId,
            channelId: session.channelId,
            platform: session.platform,
            userId: raw.userId,
            selfId: session.selfId,
            limit: Math.min(raw.limit || 100, 500),
            offset: raw.offset,
            purpose: 'general'
        }

        if (raw.startTime) filter.startTime = parseTime(raw.startTime)
        if (raw.endTime) filter.endTime = parseTime(raw.endTime)
        if (
            filter.startTime &&
            filter.endTime &&
            filter.startTime > filter.endTime
        ) {
            throw new Error('startTime must be earlier than endTime.')
        }
        return filter
    }
}

class GroupUserPersonaTool extends StructuredTool {
    name = 'group_user_persona'
    schema = groupUserPersonaSchema
    description =
        'Retrieve the stored persona profile for a specific user ID within the current bot instance.'

    constructor(
        private ctx: Context,
        private config: Config
    ) {
        super({})
    }

    async _call(
        input: z.infer<typeof groupUserPersonaSchema>,
        _runManager: unknown,
        runnable: ChatLunaToolRunnable
    ) {
        const session = runnable.configurable.session as Session | undefined
        if (!session)
            return 'Session context is unavailable; cannot look up user persona.'
        if (this.config.personaUserFilter.includes(input.user_id)) {
            return `User ${input.user_id} is in the persona filter list and cannot be analyzed.`
        }

        try {
            const result =
                await this.ctx.chatluna_group_analysis.getUserPersona(
                    session.platform,
                    session.selfId,
                    input.user_id
                )
            if (!result)
                return `No persona profile found for user ${input.user_id}.`

            const { profile, username } = result
            return JSON.stringify(
                {
                    userId: profile.userId,
                    username,
                    summary: profile.summary,
                    keyTraits: profile.keyTraits,
                    interests: profile.interests,
                    communicationStyle: profile.communicationStyle,
                    evidence: profile.evidence,
                    lastMergedFromHistory: !!profile.lastMergedFromHistory
                },
                null,
                2
            )
        } catch (error) {
            const reason =
                error instanceof Error
                    ? error.message
                    : 'Unknown error while retrieving persona.'
            return `Failed to retrieve user persona: ${reason}`
        }
    }
}

function parseTime(value: string) {
    const parsed = parseDate(value.trim(), new Date())
    if (!parsed)
        throw new Error(
            `Unable to understand "${value}". Use natural English time expressions.`
        )
    return parsed
}

const groupMessageFilterSchema = z.object({
    userId: z
        .array(z.string())
        .optional()
        .describe('Only return messages sent by the specified user ID array.'),
    startTime: z
        .string()
        .optional()
        .describe('Start time in natural English, for example "2 hours ago".'),
    endTime: z
        .string()
        .optional()
        .describe('End time in natural English, for example "now".'),
    limit: z
        .number()
        .optional()
        .describe('Maximum number of messages to retrieve, up to 500.'),
    offset: z
        .number()
        .optional()
        .describe('Offset for pagination when reading the database.')
})

const groupMessageFetchSchema = z.object({
    filter: groupMessageFilterSchema.optional().default({})
})

const groupUserPersonaSchema = z.object({
    user_id: z
        .string()
        .describe('The target user ID whose persona should be retrieved.')
})
