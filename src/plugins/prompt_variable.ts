import { Context } from 'koishi'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { Config } from '../config'
import { UserPersonaProfile } from '../types'

export const inject = [
    'chatluna_group_analysis',
    'chatluna_group_analysis_message'
]

export function apply(ctx: Context, config: Config) {
    const logger = createLogger(ctx, 'chatluna-group-analysis')

    ctx.effect(() =>
        ctx.chatluna.promptRenderer.registerFunctionProvider(
            'group_message_fetch',
            async (args, _variables, configurable) => {
                const session = configurable && configurable.session
                if (!session) return ''

                const limit = Number(args[0] || config.maxMessages || 100)
                if (!Number.isFinite(limit) || limit <= 0) return ''

                try {
                    const messages =
                        await ctx.chatluna_group_analysis_message.getHistoricalMessages(
                            {
                                guildId: session.guildId,
                                channelId: session.channelId,
                                platform: session.platform,
                                selfId: session.selfId,
                                limit: Math.min(limit, 500),
                                purpose: 'general'
                            }
                        )
                    if (!messages.length) return ''

                    const lines = messages.map(
                        (message) =>
                            `- [${message.timestamp.toISOString()}] ${message.username}: ${message.content}`
                    )
                    return `# Group Message History\n\n${lines.join('\n')}`
                } catch (error) {
                    logger.error('Error fetching group messages:', error)
                    return ''
                }
            }
        )
    )

    ctx.effect(() =>
        ctx.chatluna.promptRenderer.registerFunctionProvider(
            'group_user_persona',
            async (args, _variables, configurable) => {
                const session = configurable && configurable.session
                if (!session) return ''

                const userId = args[0] || session.userId || session.uid
                if (!userId || config.personaUserFilter.includes(userId))
                    return ''

                try {
                    const result =
                        await ctx.chatluna_group_analysis.getUserPersona(
                            session.platform,
                            session.selfId,
                            userId
                        )
                    return result
                        ? formatPersona(result.profile, result.username)
                        : ''
                } catch (error) {
                    logger.error('Error retrieving user persona:', error)
                    return ''
                }
            }
        )
    )
}

function formatPersona(profile: UserPersonaProfile, username: string) {
    const sections = [`# User Profile: ${username}`, '']

    if (profile.summary) sections.push('## Summary', profile.summary, '')
    if (profile.keyTraits.length) {
        sections.push(
            '## Key Traits',
            ...profile.keyTraits.map((trait) => `- ${trait}`),
            ''
        )
    }
    if (profile.interests.length) {
        sections.push(
            '## Interests',
            ...profile.interests.map((interest) => `- ${interest}`),
            ''
        )
    }
    if (profile.communicationStyle) {
        sections.push('## Communication Style', profile.communicationStyle, '')
    }
    if (profile.evidence.length) {
        sections.push(
            '## Evidence',
            ...profile.evidence.map((item) => `- ${item}`)
        )
    }
    return sections.join('\n')
}
