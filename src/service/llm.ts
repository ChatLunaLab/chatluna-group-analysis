import { Context, Service } from 'koishi'
import { Config } from '../index'
import {
    GoldenQuote,
    SummaryTopic,
    UserPersonaProfile,
    UserStats,
    UserTitle
} from '../types'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { load } from 'js-yaml'

export class LLMService extends Service {
    static readonly inject = ['chatluna']

    private model: ComputedRef<ChatLunaChatModel>

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_llm', true)
    }

    private async loadModel() {
        if (this.model) return

        this.model = await this.ctx.chatluna.createChatModel(this.config.model)
    }

    private async _callLLM<T>(prompt: string, taskName: string): Promise<T> {
        await this.loadModel()

        const model = this.model.value
        const logger = this.ctx.logger

        if (!model) {
            logger.warn(
                `未找到 ChatLuna 模型 ${this.config.model}，请检查配置。`
            )

            return null
        }

        return await model.caller.call(async () => {
            logger.info(`正在调用 ChatLuna 模型进行 ${taskName}...`)
            const response = await model.invoke(prompt, {
                temperature: this.config.temperature ?? 1
            })

            const rawContent = getMessageContent(response.content)

            logger.info(`LLM 原始响应: ${rawContent || '[空响应]'}`)

            // Extract YAML from markdown code block (supports both yaml and yml)
            const yamlMatch = rawContent.match(/```ya?ml\s*([\s\S]*?)\s*```/)
            if (!yamlMatch) {
                logger.warn(`未找到 YAML 代码块，无法解析。`)
                throw new Error('未找到 YAML 响应。')
            }

            try {
                const data = load(yamlMatch[1]) as T
                if (Array.isArray(data)) {
                    logger.info(`成功解析 ${data.length} 条数据。`)
                }
                return data
            } catch (err) {
                logger.error('解析 YAML 失败:', err)
                logger.error(
                    '待解析的 YAML 字符串:',
                    yamlMatch[1] || '[空字符串]'
                )
                throw err
            }
        })
    }

    public async summarizeTopics(
        messagesText: string
    ): Promise<SummaryTopic[]> {
        const prompt = this.config.promptTopic
            .replace('{messages}', messagesText)
            .replace('{maxTopics}', this.config.maxTopics.toString())
        return this._callLLM<SummaryTopic[]>(prompt, '话题分析').then(
            (data) => data ?? []
        )
    }

    public async analyzeUserTitles(users: UserStats[]): Promise<UserTitle[]> {
        const userSummaries = users
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, this.config.maxUserTitles)
            .map(
                (user) =>
                    `- ${user.nickname} (QQ:${user.userId}): ` +
                    `发言${user.messageCount}条, 平均${user.avgChars}字, ` +
                    `表情比例${user.emojiRatio}, 夜间发言比例${user.nightRatio}, ` +
                    `回复比例${user.replyRatio}`
            )
            .join('\n')

        const prompt = this.config.promptUserTitles.replace(
            '{users}',
            userSummaries
        )
        return this._callLLM<UserTitle[]>(prompt, '用户称号分析').then(
            (data) => data ?? []
        )
    }

    public async analyzeGoldenQuotes(
        messagesText: string,
        maxQuotes: number
    ): Promise<GoldenQuote[]> {
        const prompt = this.config.promptGoldenQuotes
            .replace('{messages}', messagesText)
            .replace('{maxGoldenQuotes}', String(maxQuotes))
        return this._callLLM<GoldenQuote[]>(prompt, '金句分析').then(
            (data) => data ?? []
        )
    }

    public async analyzeUserPersona(
        userId: string,
        username: string,
        roles: string[],
        recentMessages: string,
        previousAnalysis?: string
    ): Promise<UserPersonaProfile | null> {
        const filledPrompt = this.config.promptUserPersona
            .replace('{messages}', recentMessages || '（最近暂无发言记录）')
            .replace(
                '{previousAnalysis}',
                previousAnalysis || '（无历史画像，请从零开始）'
            )
            .replace('{roles}', roles?.join(', ') || '（未知角色）')
            .replace('{userId}', userId)
            .replace('{username}', username || userId)
            .replace(
                '{personaLookbackDays}',
                String(this.config.personaLookbackDays)
            )

        const resultArray = await this._callLLM<UserPersonaProfile[]>(
            filledPrompt,
            '用户画像分析'
        )
        const result = resultArray[0] || null
        if (!result) return null
        result.username = username
        return result
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_llm: LLMService
    }
}
