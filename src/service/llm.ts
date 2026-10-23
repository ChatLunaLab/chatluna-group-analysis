import { Context, Service } from 'koishi'
import { load } from 'js-yaml'
import { z } from 'zod'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Config } from '../config'
import {
    AnalysisPromptContext,
    GoldenQuote,
    QueryIntent,
    SummaryTopic,
    UserPersonaProfile,
    UserStats,
    UserTitle
} from '../types'

const topicSchema = z.object({
    topic: z.string(),
    contributors: z.array(z.string()),
    detail: z.string()
})

const userTitleSchema = z.object({
    name: z.string(),
    id: z.number(),
    title: z.string(),
    mbti: z.string(),
    reason: z.string()
})

const goldenQuoteSchema = z.object({
    content: z.string(),
    sender: z.string(),
    reason: z.string()
})

const personaSchema = z.object({
    userId: z.string(),
    username: z.string(),
    summary: z.string(),
    keyTraits: z.array(z.string()),
    interests: z.array(z.string()),
    communicationStyle: z.string(),
    analysisDate: z.string().optional(),
    evidence: z.array(z.string()),
    lastMergedFromHistory: z.boolean().optional()
})

const queryIntentSchema = z.object({
    action: z.enum(['只分析', '分析加对话', '只对话']).optional(),
    keywords: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    nicknames: z.array(z.string()).optional(),
    targetTime: z
        .object({
            description: z.string().optional(),
            startTime: z.string().optional(),
            endTime: z.string().optional()
        })
        .optional(),
    query: z.string().optional()
})

export class LLMService extends Service {
    static readonly inject = ['chatluna']

    private models = new Map<string, ComputedRef<ChatLunaChatModel>>()

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_llm', true)
    }

    summarizeTopics(messagesText: string, context: AnalysisPromptContext = {}) {
        const prompt = this.fillAnalysisPrompt(
            this.config.promptTopic,
            context,
            {
                messages: messagesText,
                maxTopics: this.config.maxTopics
            }
        )
        return this.callYaml<SummaryTopic[]>(
            z.array(topicSchema),
            prompt,
            '话题分析'
        ).then((data) => data || [])
    }

    analyzeUserTitles(users: UserStats[], context: AnalysisPromptContext = {}) {
        const userSummaries = [...users]
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, this.config.maxUserTitles)
            .map(
                (user) =>
                    `- ${user.nickname} (QQ:${user.userId}): 发言${user.messageCount}条, ` +
                    `平均${user.avgChars}字, 表情比例${user.emojiRatio}, ` +
                    `夜间发言比例${user.nightRatio}, 回复比例${user.replyRatio}`
            )
            .join('\n')
        const prompt = this.fillAnalysisPrompt(
            this.config.promptUserTitles,
            context,
            {
                users: userSummaries
            }
        )
        return this.callYaml<UserTitle[]>(
            z.array(userTitleSchema),
            prompt,
            '用户称号分析'
        ).then((data) => data || [])
    }

    analyzeGoldenQuotes(
        messagesText: string,
        maxQuotes: number,
        context: AnalysisPromptContext = {}
    ) {
        const prompt = this.fillAnalysisPrompt(
            this.config.promptGoldenQuotes,
            context,
            {
                messages: messagesText,
                maxGoldenQuotes: maxQuotes
            }
        )
        return this.callYaml<GoldenQuote[]>(
            z.array(goldenQuoteSchema),
            prompt,
            '金句分析'
        ).then((data) => data || [])
    }

    async analyzeUserPersona(
        userId: string,
        username: string,
        roles: string[],
        recentMessages: string,
        previousAnalysis = ''
    ) {
        const prompt = fillPrompt(this.config.promptUserPersona, {
            messages: recentMessages || '（最近暂无发言记录）',
            previousAnalysis: previousAnalysis || '（无历史画像，请从零开始）',
            roles: roles.join(', ') || '（未知角色）',
            userId,
            username: username || userId,
            personaLookbackDays: this.config.personaLookbackDays
        })
        const response = await this.callYaml<
            UserPersonaProfile | UserPersonaProfile[]
        >(
            z.union([personaSchema, z.array(personaSchema)]),
            prompt,
            '用户画像分析'
        )
        if (!response) return null

        const profile = Array.isArray(response) ? response[0] : response
        if (!profile) return null
        profile.userId = userId
        profile.username = username
        return profile
    }

    async parseGroupQuery(promptContext: {
        query: string
        currentTime: string
        timeZone: string
        platform: string
        groupName: string
        guildId?: string
        channelId?: string
        currentUserId?: string
        currentUserName?: string
    }): Promise<QueryIntent | null> {
        const prompt = fillPrompt(this.config.promptQueryParser, {
            currentTime: promptContext.currentTime,
            timeZone: promptContext.timeZone,
            platform: promptContext.platform,
            groupName: promptContext.groupName || '未知群聊',
            guildId: promptContext.guildId || '',
            channelId: promptContext.channelId || '',
            currentUserId: promptContext.currentUserId || '',
            currentUserName: promptContext.currentUserName || '',
            query: promptContext.query
        })

        try {
            return await this.callYaml<QueryIntent>(
                queryIntentSchema,
                prompt,
                '群分析请求解析',
                this.config.smallModel || this.config.model
            )
        } catch (error) {
            this.ctx.logger.warn('解析群分析请求失败:', error)
            return null
        }
    }

    replyGroupQuery(promptContext: {
        query: string
        analysisResult: string
        currentTime: string
        groupName: string
        guildId?: string
        channelId?: string
        currentUserId?: string
        currentUserName?: string
    }) {
        const prompt = fillPrompt(this.config.promptQueryChat, {
            currentTime: promptContext.currentTime,
            groupName: promptContext.groupName || '未知群聊',
            guildId: promptContext.guildId || '',
            channelId: promptContext.channelId || '',
            currentUserId: promptContext.currentUserId || '',
            currentUserName: promptContext.currentUserName || '',
            query: promptContext.query,
            analysisResult: promptContext.analysisResult
        })
        return this.invoke(prompt, '群分析对话回复', this.config.model)
    }

    private async loadModel(modelName: string) {
        const existing = this.models.get(modelName)
        if (existing) return existing

        const model = await this.ctx.chatluna.createChatModel(modelName)
        this.models.set(modelName, model)
        return model
    }

    private async invoke(
        prompt: string,
        taskName: string,
        modelName = this.config.model
    ) {
        const modelRef = await this.loadModel(modelName)
        const model = modelRef.value
        if (!model) {
            this.ctx.logger.warn(
                `未找到 ChatLuna 模型 ${modelName}，请检查配置。`
            )
            return null
        }

        return model.caller.call(async () => {
            this.ctx.logger.info(`正在调用 ChatLuna 模型进行 ${taskName}...`)
            const response = await model.invoke(prompt, {
                temperature: this.config.temperature
            })
            const content = getMessageContent(response.content)
            if (this.config.debug)
                this.ctx.logger.debug(`LLM 原始响应: ${content || '[空响应]'}`)
            return content
        })
    }

    private async callYaml<T>(
        schema: z.ZodTypeAny,
        prompt: string,
        taskName: string,
        modelName = this.config.model
    ): Promise<T | null> {
        const content = await this.invoke(prompt, taskName, modelName)
        if (content === null) return null

        const match = content.match(/```ya?ml\s*([\s\S]*?)\s*```/)
        if (!match) throw new Error('未找到 YAML 响应。')

        try {
            return schema.parse(load(match[1])) as T
        } catch (error) {
            this.ctx.logger.warn(`解析 ${taskName} 的 YAML 响应失败。`, error)
            throw error
        }
    }

    private fillAnalysisPrompt(
        template: string,
        context: AnalysisPromptContext,
        values: Record<string, string | number>
    ) {
        return fillPrompt(template, {
            ...values,
            keywords:
                context.keywords && context.keywords.length
                    ? context.keywords.join('、')
                    : '（无）',
            topics:
                context.topics && context.topics.length
                    ? context.topics.join('、')
                    : '（无）',
            nicknames:
                context.nicknames && context.nicknames.length
                    ? context.nicknames.join('、')
                    : '（无）',
            query: context.query || '（无）',
            timeRange: formatTimeRange(context)
        })
    }
}

function fillPrompt(template: string, values: Record<string, string | number>) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        const value = values[key]
        return value === undefined ? match : String(value)
    })
}

function formatTimeRange(context: AnalysisPromptContext) {
    if (!context.timeRange) return '（未指定）'
    const { start, end, description } = context.timeRange
    const range = `${start.toLocaleString('zh-CN', { hour12: false })} ~ ${end.toLocaleString('zh-CN', { hour12: false })}`
    return description ? `${description} (${range})` : range
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_llm: LLMService
    }
}
