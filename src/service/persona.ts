import { Context, h, Service, Session } from 'koishi'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import type { GuildMember } from '@satorijs/protocol'
import type { OneBotBot } from 'koishi-plugin-adapter-onebot'
import { Config } from '../config'
import {
    PersonaCache,
    PersonaRecord,
    StoredMessage,
    UserPersonaProfile
} from '../types'
import {
    buildPersonaRecordId,
    formatMessagesForPersona,
    formatPersonaForPrompt,
    getAvatarUrl,
    mergePersona,
    MessageScope,
    shouldListenToMessage
} from '../utils'
import { getStartTimeByDays, isCacheExpired } from '../utils/time'

export class PersonaService extends Service {
    static readonly inject = [
        'database',
        'chatluna_group_analysis_message',
        'chatluna_group_analysis_llm',
        'chatluna_group_analysis_renderer'
    ]

    private cache = new Map<string, PersonaCache>()
    private cacheLoads = new Map<string, Promise<PersonaCache>>()
    private tasks = new Map<string, Promise<boolean>>()

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_persona', true)
        ctx.database.extend(
            'chatluna_user_personas',
            {
                id: { type: 'char', length: 100 },
                platform: { type: 'char', length: 30 },
                selfId: { type: 'char', length: 100 },
                userId: { type: 'char', length: 100 },
                username: { type: 'char', length: 254 },
                persona: { type: 'text', nullable: true },
                lastAnalysisAt: { type: 'timestamp', nullable: true },
                updatedAt: { type: 'timestamp', nullable: true }
            },
            { primary: 'id' }
        )

        if (!config.personaAnalysisMessageInterval) return
        ctx.chatluna_group_analysis_message.onUserMessage(async (session) => {
            const allowed = shouldListenToMessage(
                session,
                config.listenerGroups,
                config.enableAllGroupsByDefault
            )
            if (allowed) await this.handleIncomingMessage(session)
        })
    }

    async getUserPersona(platform: string, selfId: string, userId: string) {
        const id = buildPersonaRecordId(platform, selfId, userId)
        const cache = await this.ensureCache(id, {
            platform,
            selfId,
            userId,
            username: userId
        })
        if (!cache.parsedPersona) return null
        return { profile: cache.parsedPersona, username: cache.record.username }
    }

    async executeUserPersonaAnalysis(
        session: Session,
        userId: string,
        force = false
    ) {
        await session.send('正在查询用户画像数据，请稍候...')

        try {
            let user: GuildMember | undefined
            try {
                user = await session.bot.getGuildMember(
                    session.channelId || session.guildId,
                    userId
                )
            } catch (error) {
                this.ctx.logger.warn(`获取用户 ${userId} 信息失败: ${error}`)
            }

            const id = buildPersonaRecordId(
                session.platform,
                session.selfId,
                userId
            )
            const cache = await this.ensureCache(id, {
                platform: session.platform,
                selfId: session.selfId,
                userId,
                username: user ? user.nick || user.name || userId : userId
            })
            const expired = isCacheExpired(
                cache.record.lastAnalysisAt,
                this.config.personaCacheLifetimeDays * 24 * 60 * 60 * 1000
            )

            if (force || expired || !cache.parsedPersona) {
                if (
                    !force &&
                    cache.parsedPersona &&
                    expired &&
                    this.config.personaCacheLifetimeDays > 0
                ) {
                    await session.send(
                        `上次用户画像更新已超过 ${this.config.personaCacheLifetimeDays} 天，正在重新生成画像。`
                    )
                }

                const refreshed = await this.refresh(cache, {
                    guildId: session.guildId || undefined,
                    channelId: session.channelId || undefined,
                    platform: session.platform,
                    selfId: session.selfId
                })
                if (!cache.parsedPersona) {
                    await session.send(
                        '暂未收集到足够的聊天记录来生成该用户的画像，请稍后再试。'
                    )
                    return
                }
                if (!refreshed) await session.send('本次未更新，展示旧画像。')
                cache.pendingMessages = 0
            }

            let displayName = cache.record.username
            let avatar: string | undefined
            if (user) {
                avatar = user.avatar
                displayName = user.nick || user.name || displayName
                cache.record.username = displayName
            }
            if (session.platform === 'onebot') avatar = getAvatarUrl(userId)

            const profile = cache.parsedPersona
            profile.analysisDate = cache.record.lastAnalysisAt
                ? cache.record.lastAnalysisAt.toLocaleString()
                : new Date().toLocaleString()
            const image =
                await this.ctx.chatluna_group_analysis_renderer.renderUserPersona(
                    profile,
                    displayName,
                    avatar,
                    this.config
                )
            await session.send(
                typeof image === 'string'
                    ? h.text(image)
                    : h.image(image, 'image/png')
            )
        } catch (error) {
            this.ctx.logger.error(
                `为用户 ${userId} 执行画像分析时发生错误:`,
                error
            )
            const reason = error instanceof Error ? error.message : '未知错误。'
            await session.send(
                `分析失败: ${reason}。请检查服务状态或联系管理员。`
            )
        }
    }

    private async handleIncomingMessage(session: Session) {
        if (
            !session.userId ||
            this.config.personaUserFilter.includes(session.userId)
        )
            return

        const id = buildPersonaRecordId(
            session.platform,
            session.selfId,
            session.userId
        )
        const cache = await this.ensureCache(id, {
            platform: session.platform,
            selfId: session.selfId,
            userId: session.userId,
            username: session.username || session.userId
        })
        cache.pendingMessages++
        cache.record.username = session.username || cache.record.username

        if (
            cache.pendingMessages <
                this.config.personaAnalysisMessageInterval ||
            this.tasks.has(id)
        )
            return

        this.refresh(cache, {
            guildId: session.guildId || undefined,
            channelId: session.channelId || undefined,
            platform: session.platform,
            selfId: session.selfId
        })
            .catch((error) => {
                this.ctx.logger.error(`执行用户画像分析失败 (${id}):`, error)
            })
            .finally(() => {
                cache.pendingMessages = Math.max(
                    0,
                    cache.pendingMessages -
                        this.config.personaAnalysisMessageInterval
                )
            })
    }

    private ensureCache(
        id: string,
        defaults: Pick<
            PersonaRecord,
            'platform' | 'selfId' | 'userId' | 'username'
        >
    ): Promise<PersonaCache> {
        const cached = this.cache.get(id)
        if (cached) return Promise.resolve(cached)

        const loading = this.cacheLoads.get(id)
        if (loading) return loading

        const task = this.loadCache(id, defaults).finally(() =>
            this.cacheLoads.delete(id)
        )
        this.cacheLoads.set(id, task)
        return task
    }

    private async loadCache(
        id: string,
        defaults: Pick<
            PersonaRecord,
            'platform' | 'selfId' | 'userId' | 'username'
        >
    ): Promise<PersonaCache> {
        const records = await this.ctx.database
            .select('chatluna_user_personas')
            .where({ id })
            .execute()
        const existing = records[0]
        let parsedPersona: UserPersonaProfile | null = null

        if (existing) {
            if (existing.lastAnalysisAt)
                existing.lastAnalysisAt = new Date(existing.lastAnalysisAt)
            if (existing.updatedAt)
                existing.updatedAt = new Date(existing.updatedAt)
            if (existing.persona) {
                try {
                    parsedPersona = yamlLoad(
                        existing.persona
                    ) as UserPersonaProfile
                } catch (error) {
                    this.ctx.logger.warn(
                        `解析用户画像 YAML 失败 (${id})，将忽略历史画像。`,
                        error
                    )
                }
            }
        }

        const record =
            existing || ({ id, ...defaults, roles: [] } as PersonaRecord)
        record.roles = record.roles || []
        const cache: PersonaCache = {
            record,
            pendingMessages: 0,
            parsedPersona
        }

        if (this.cache.size >= 1000) {
            const oldest = this.cache.keys().next().value
            if (oldest) this.cache.delete(oldest)
        }
        this.cache.set(id, cache)
        return cache
    }

    private refresh(
        cache: PersonaCache,
        sourceGroup: MessageScope
    ): Promise<boolean> {
        const id = cache.record.id
        const running = this.tasks.get(id)
        if (running) return running

        const task = this.analyze(cache, sourceGroup).finally(() =>
            this.tasks.delete(id)
        )
        this.tasks.set(id, task)
        return task
    }

    private async analyze(cache: PersonaCache, sourceGroup: MessageScope) {
        const { record } = cache
        const startTime = getStartTimeByDays(
            this.config.personaLookbackDays,
            this.config.useCalendarDayWindow
        )
        const messages = await this.collectMessages(
            record,
            startTime,
            sourceGroup
        )
        if (messages.length < this.config.personaMinMessages) {
            this.ctx.logger.info(
                `用户 ${record.userId} 的历史消息不足，跳过画像分析。`
            )
            return false
        }

        const persona =
            await this.ctx.chatluna_group_analysis_llm.analyzeUserPersona(
                record.userId,
                record.username,
                record.roles,
                formatMessagesForPersona(messages),
                formatPersonaForPrompt(cache.parsedPersona)
            )
        if (!persona) return false

        const merged = mergePersona(cache.parsedPersona, persona)
        cache.parsedPersona = merged
        await this.persist(record, merged)
        return true
    }

    private async collectMessages(
        record: PersonaRecord,
        startTime: Date,
        sourceGroup: MessageScope
    ) {
        const groups: MessageScope[] = this.config.enableAllGroupsByDefault
            ? [sourceGroup]
            : this.config.listenerGroups.filter(
                  (group) =>
                      group.enabled &&
                      group.platform === record.platform &&
                      group.selfId === record.selfId
              )
        if (!groups.length) return []

        const results: StoredMessage[] = []
        for (const group of groups) {
            const bot = this.ctx.bots.find(
                (item) => item.selfId === group.selfId
            )
            if (!bot) continue

            try {
                let member: GuildMember
                if (bot.platform === 'onebot') {
                    member = await (
                        bot as OneBotBot<Context>
                    ).internal.getGroupMemberInfo(
                        group.guildId,
                        record.userId,
                        true
                    )
                } else {
                    member = await bot.getGuildMember(
                        group.channelId || group.guildId,
                        record.userId
                    )
                }
                record.roles = member.roles
                    ? member.roles.map((role) => role.name || role.id)
                    : []
            } catch (error) {
                this.ctx.logger.warn(
                    `获取用户 ${record.userId} 的群组资料失败，将继续读取历史消息。`,
                    error
                )
            }

            const remaining = this.config.personaMaxMessages - results.length
            if (remaining <= 0) break
            const history =
                await this.ctx.chatluna_group_analysis_message.getHistoricalMessages(
                    {
                        guildId: group.guildId,
                        channelId: group.channelId,
                        userId: [record.userId],
                        selfId: group.selfId,
                        startTime,
                        endTime: new Date(),
                        limit: remaining,
                        purpose: 'user-persona'
                    }
                )
            results.push(
                ...history.map((message) => ({
                    ...message,
                    guildId: message.guildId || group.guildId,
                    channelId: message.channelId || group.channelId
                }))
            )
        }

        return results.sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        )
    }

    private async persist(record: PersonaRecord, persona: UserPersonaProfile) {
        const now = new Date()
        record.persona = yamlDump(persona, {
            indent: 2,
            lineWidth: -1,
            noRefs: true
        })
        record.lastAnalysisAt = now
        record.updatedAt = now
        await this.ctx.database.upsert('chatluna_user_personas', [record])
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_persona: PersonaService
    }

    interface Tables {
        chatluna_user_personas: PersonaRecord
    }
}
