/* eslint-disable max-len */
import { Context } from 'koishi'
import { Config } from '..'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

export async function apply(ctx: Context, config: Config) {
    const logger = createLogger(ctx, 'chatluna-group-analysis')

    // Register group_message_fetch variable
    ctx.chatluna.promptRenderer.registerFunctionProvider(
        'group_message_fetch',
        async (args, variables, configurable) => {
            logger.debug(
                `group_message_fetch function called with args: ${args}`
            )

            const session = configurable?.session
            if (!session) {
                logger.warn('Session context is unavailable')
                return ''
            }

            try {
                // Parse limit from arguments, default to config or 100
                const limit =
                    args.length > 0
                        ? parseInt(args[0])
                        : config.maxMessages || 100

                if (isNaN(limit) || limit <= 0) {
                    logger.warn(`Invalid limit: ${args[0]}, using default`)
                    return ''
                }

                const filter = {
                    guildId: session.guildId,
                    channelId: session.channelId,
                    selfId: session.selfId,
                    limit: Math.min(limit, 500), // Cap at 500
                    purpose: 'general' as const
                }

                const messages =
                    await ctx.chatluna_group_analysis_message.getHistoricalMessages(
                        filter
                    )

                if (!messages.length) {
                    logger.debug('No historical messages found')
                    return ''
                }

                logger.debug(`Retrieved ${messages.length} historical messages`)

                // Format messages
                const formattedMessages = messages.map((msg) => ({
                    username: msg.username,
                    timestamp: msg.timestamp.toISOString(),
                    content: msg.content
                }))

                const header = `# Group Message History\n\nThe following are recent messages from this group (${messages.length} messages):\n`

                const messageList = formattedMessages
                    .map(
                        (msg) =>
                            `- [${msg.timestamp}] ${msg.username}: ${msg.content}`
                    )
                    .join('\n')

                return header + '\n' + messageList
            } catch (error) {
                logger.error('Error fetching group messages:', error)
                return ''
            }
        }
    )

    // Register group_user_persona variable
    ctx.chatluna.promptRenderer.registerFunctionProvider(
        'group_user_persona',
        async (args, variables, configurable) => {
            logger.debug(
                `group_user_persona function called with args: ${args}`
            )

            const session = configurable?.session
            if (!session) {
                logger.warn('Session context is unavailable')
                return ''
            }

            try {
                // Parse user ID from arguments, default to session userId
                const userId =
                    args.length > 0 ? args[0] : session.userId || session.uid

                if (!userId) {
                    logger.warn('No user ID available')
                    return ''
                }

                // Check if user is in personaUserFilter
                if (config.personaUserFilter?.includes(userId)) {
                    logger.debug(
                        `User ${userId} is in persona filter list, skipping`
                    )
                    return ''
                }

                const result = await ctx.chatluna_group_analysis.getUserPersona(
                    session.platform,
                    session.selfId,
                    userId
                )

                if (!result) {
                    logger.debug(`No persona profile found for user ${userId}`)
                    return ''
                }

                const { profile, username } = result

                logger.debug(`Retrieved persona for user ${userId}`)

                // Format persona profile
                const sections: string[] = []

                sections.push(`# User Profile: ${username}`)
                sections.push('')

                if (profile.summary) {
                    sections.push(`## Summary`)
                    sections.push(profile.summary)
                    sections.push('')
                }

                if (profile.keyTraits && profile.keyTraits.length > 0) {
                    sections.push(`## Key Traits`)
                    profile.keyTraits.forEach((trait) => {
                        sections.push(`- ${trait}`)
                    })
                    sections.push('')
                }

                if (profile.interests && profile.interests.length > 0) {
                    sections.push(`## Interests`)
                    profile.interests.forEach((interest) => {
                        sections.push(`- ${interest}`)
                    })
                    sections.push('')
                }

                if (profile.communicationStyle) {
                    sections.push(`## Communication Style`)
                    sections.push(profile.communicationStyle)
                    sections.push('')
                }

                if (profile.evidence && profile.evidence.length > 0) {
                    sections.push(`## Evidence`)
                    profile.evidence.forEach((evidence) => {
                        sections.push(`- ${evidence}`)
                    })
                }

                return sections.join('\n')
            } catch (error) {
                logger.error('Error retrieving user persona:', error)
                return ''
            }
        }
    )
}
