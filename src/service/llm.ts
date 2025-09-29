import { Context, Service } from 'koishi'
import { Config } from '../index'
import { GoldenQuote, SummaryTopic, UserStats, UserTitle } from '../types'
import { ComputedRef } from 'koishi-plugin-chatluna'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

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

    private async _callLLM<T>(prompt: string, taskName: string): Promise<T[]> {
        await this.loadModel()

        const model = this.model.value
        const logger = this.ctx.logger

        if (!model) {
            logger.warn(
                `未找到 ChatLuna 模型 ${this.config.model}，请检查配置。`
            )

            return []
        }

        logger.info(`正在调用 ChatLuna 模型进行 ${taskName}...`)
        const response = await model.invoke(prompt)

        const rawContent = getMessageContent(response.content)

        logger.info(`LLM 原始响应: ${rawContent || '[空响应]'}`)

        const jsonMatch = rawContent.match(/\[.*\]/s)
        if (!jsonMatch) {
            logger.warn(`未找到 JSON 数组，无法解析。`)
            return []
        }

        try {
            const data = JSON.parse(jsonMatch[0]) as T[]
            logger.info(`成功解析 ${data.length} 条结果。`)
            return data
        } catch (err) {
            logger.error('解析 JSON 失败:', err)
            logger.debug('待解析的 JSON 字符串:', jsonMatch[0] || '[空字符串]')
            return []
        }
    }

    public async summarizeTopics(
        messagesText: string
    ): Promise<SummaryTopic[]> {
        const prompt = this.config.promptTopic
            .replace('{messages}', messagesText)
            .replace('{maxTopics}', this.config.maxTopics.toString())
        return this._callLLM(prompt, '话题分析')
    }

    public async analyzeUserTitles(users: UserStats[]): Promise<UserTitle[]> {
        const userSummaries = users
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, this.config.maxUserTitles)
            .map(
                (user) =>
                    `- ${user.nickname} (QQ:${user.userId}): ` +
                    `发言${user.messageCount}条, 平均${user.avgChars}字, ` +
                    `表情比例${user.replyRatio}, 夜间发言比例${user.nightRatio}, ` +
                    `回复比例${user.replyRatio}`
            )
            .join('\n')

        const prompt = this.config.promptUserTitles.replace(
            '{users}',
            userSummaries
        )
        return this._callLLM(prompt, '用户称号分析')
    }

    public async analyzeGoldenQuotes(
        messagesText: string,
        maxQuotes: number
    ): Promise<GoldenQuote[]> {
        const prompt = this.config.promptGoldenQuotes
            .replace('{messages}', messagesText)
            .replace('{maxGoldenQuotes}', String(maxQuotes))
        return this._callLLM(prompt, '金句分析')
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_llm: LLMService
    }
}
