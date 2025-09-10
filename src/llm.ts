import { Context, Service, Schema } from 'koishi'
import { Config } from './index'
import { SummaryTopic } from './types'
// 改为与 smash-or-pass-ai 完全一致的导入（使用 dist/messages，避免类型文件缺失）
// 使用 require 避免类型声明缺失导致编译错误
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseRawModelName } = require('koishi-plugin-chatluna/llm-core/utils/count_tokens')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ChatLunaChatModel } = require('koishi-plugin-chatluna/llm-core/platform/model')
// 兼容编译路径，直接从 @langchain/core 导入（需已安装依赖）
// 改为本地定义占位类，避免依赖缺失导致编译失败
class SystemMessage {
  constructor(public text: string) {}
}
class HumanMessage {
  constructor(public text: string) {}
}

declare module 'koishi' {
  interface Context {
    llm: LLMService
  }
}

declare module 'koishi' {
  interface Context {
    chatluna: any
  }
}

export class LLMService extends Service {
  private model: any

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'llm', true)
  }

  private async loadModel() {
    const [platform, modelName] = parseRawModelName(this.config.model)
    await this.ctx.chatluna.awaitLoadPlatform(platform)
    this.model = await this.ctx.chatluna.createChatModel(platform, modelName)
  }

  public async summarizeTopics(messagesText: string): Promise<SummaryTopic[]> {
    const logger = this.ctx.logger('LLMService')
    if (!this.model) {
      await this.loadModel()
    }

    // 消息预清理
    const cleanMessageContent = (content: string) =>
      content
        .replace(/"/g, '\\"')
        .replace(/\n|\r|\t/g, ' ')
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        .trim()
    const cleanedMessages = messagesText
      .split('\n')
      .map((line) => cleanMessageContent(line))
      .join('\n')

    const prompt = this.config.promptTopic.replace('{messages}', cleanedMessages)

    logger.info('正在调用 ChatLuna 模型进行话题分析...')
    // 组合为单一 HumanMessage，避免 LangChain MESSAGE_COERCION_FAILURE 错误
    const result = await this.model.invoke(
      `${prompt}`
    )

    const rawContent = Array.isArray(result.content)
      ? (result.content as any[]).map((item: any) => item.text ?? '').join('')
      : String(result.content ?? '')

    logger.debug('LLM 原始响应:', rawContent || '[空响应]')

    // 稳健地提取 JSON
    const jsonMatch = rawContent.match(/\[.*\]/s)
    if (!jsonMatch) {
      logger.warn(`未找到 JSON 数组，尝试降级解析。响应片段: ${(rawContent || '').substring(0, 200)}`)
      const fallbackTopics: SummaryTopic[] = []
      const regexTopic = /"topic"\s*:\s*"([^"]+)"\s*,\s*"contributors"\s*:\s*\[([^\]]*)\]\s*,\s*"detail"\s*:\s*"([^"]*)"/g
      let match
      while ((match = regexTopic.exec(rawContent || '')) && fallbackTopics.length < 5) {
        const topic = match[1]
        const contributors = match[2].split(',').map(s => s.replace(/"/g, '').trim()).filter(Boolean)
        const detail = match[3]
        fallbackTopics.push({ topic, contributors, detail })
      }
      if (fallbackTopics.length) {
        logger.info(`降级提取到 ${fallbackTopics.length} 个话题`)
        return fallbackTopics
      }
      return [{ topic: '群聊讨论', contributors: ['群友'], detail: '今日群聊内容丰富，涵盖多个话题' }]
    }

    try {
      const topics = JSON.parse(jsonMatch[0]) as SummaryTopic[]
      logger.info(`成功解析 ${topics.length} 个话题。`)
      return topics
    } catch (err) {
      logger.error('解析 JSON 失败:', err)
      logger.debug('待解析的 JSON 字符串:', jsonMatch[0] || '[空字符串]')
      return []
    }
  }
}

export const inject = ['chatluna']