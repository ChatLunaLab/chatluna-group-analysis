import { Context, Service } from 'koishi'
import { Config } from './index'
import {
    GoldenQuote,
    SummaryTopic,
    TokenUsage,
    UserStats,
    UserTitle
} from './types'

declare module 'koishi' {
    interface Context {
        llm: LLMService
        chatluna: any
    }
}

export class LLMService extends Service {
    static readonly inject = ['chatluna']

    private model: any

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'llm', true)
    }

    private _parseModelName(modelId: string): [string, string] {
        const parts = modelId.split('/')
        if (parts.length === 1) {
            // Fallback for names without a platform prefix, assuming a default platform
            return ['default', modelId]
        }
        const platform = parts[0]
        const modelName = parts.slice(1).join('/')
        return [platform, modelName]
    }

    private async loadModel() {
        if (this.model) return
        const [platform, modelName] = this._parseModelName(this.config.model)
        await this.ctx.chatluna.awaitLoadPlatform(platform)
        this.model = await this.ctx.chatluna.createChatModel(
            platform,
            modelName
        )
    }

    private async _callLLM<T>(
        prompt: string,
        taskName: string
    ): Promise<{ result: T[]; tokenUsage: TokenUsage }> {
        const logger = this.ctx.logger(`LLMService:${taskName}`)
        await this.loadModel()

        logger.info(`正在调用 ChatLuna 模型进行 ${taskName}...`)
        const response = await this.model.invoke(prompt)

        const tokenUsage: TokenUsage = {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
            totalTokens: response.usage?.total_tokens ?? 0
        }

        const rawContent = Array.isArray(response.content)
            ? response.content.map((item: any) => item.text ?? '').join('')
            : String(response.content ?? '')

        logger.debug(`LLM 原始响应: ${rawContent || '[空响应]'}`)

        const jsonMatch = rawContent.match(/\[.*\]/s)
        if (!jsonMatch) {
            logger.warn(`未找到 JSON 数组，无法解析。`)
            return { result: [], tokenUsage }
        }

        try {
            const data = JSON.parse(jsonMatch[0]) as T[]
            logger.info(`成功解析 ${data.length} 条结果。`)
            return { result: data, tokenUsage }
        } catch (err) {
            logger.error('解析 JSON 失败:', err)
            logger.debug('待解析的 JSON 字符串:', jsonMatch[0] || '[空字符串]')
            return { result: [], tokenUsage }
        }
    }

    public async summarizeTopics(
        messagesText: string
    ): Promise<{ result: SummaryTopic[]; tokenUsage: TokenUsage }> {
        const prompt = this.config.promptTopic
            .replace('{messages}', messagesText)
            .replace('{maxTopics}', String(this.config.maxTopics))
        return this._callLLM(prompt, '话题分析')
    }

    public async analyzeUserTitles(
        users: UserStats[]
    ): Promise<{ result: UserTitle[]; tokenUsage: TokenUsage }> {
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
    ): Promise<{ result: GoldenQuote[]; tokenUsage: TokenUsage }> {
        const prompt = this.config.promptGoldenQuotes
            .replace('{messages}', messagesText)
            .replace('{maxGoldenQuotes}', String(maxQuotes))
        return this._callLLM(prompt, '金句分析')
    }
}
