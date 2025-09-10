import { Context, Schema, Time } from 'koishi'

// 引入 service 的类型定义
import {} from 'koishi-plugin-puppeteer'
import {} from 'koishi-plugin-schedule'
import { GroupMessage } from './types'

export const name = 'group-analysis'

// 声明插件依赖的服务
export const inject = {
  required: ['puppeteer', 'database', 'chatluna'], // 添加 database 与 chatluna 依赖
  optional: ['scheduler'],
}

// 扩展 Tables 类型，为数据库添加新表
declare module 'koishi' {
  interface Tables {
    group_analysis_messages: GroupMessage
  }
}

// 插件的配置项
export interface Config {
  model: string
  promptTopic: string
  allowedGroups: string[]
  cronSchedule: string
  cronAnalysisDays: number
  messageRetentionDays: number
  debug?: boolean
}

// 使用 Schema 定义配置项的类型和校验规则
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    allowedGroups: Schema.array(Schema.string()).description('允许使用此插件功能的群号列表。如果留空，则所有群组都可用。'),
    cronSchedule: Schema.string().description('定时发送分析报告的 CRON 表达式。留空则禁用。例如 "0 22 * * *" 表示每天22点。'),
    cronAnalysisDays: Schema.number().description('定时任务分析的默认天数。').default(1),
    messageRetentionDays: Schema.number().description('消息记录在数据库中的最长保留天数。').default(7),
  }).description('基础设置'),
  Schema.object({
    model: Schema.dynamic('model').description('ChatLuna 模型名称').required(),
  }).description('LLM 设置'),
  Schema.object({
    promptTopic: Schema.string().description('话题分析的提示词模板。').default(
      '你是一个专业的群聊分析助手。请根据以下群聊内容，总结出 3-5 个主要讨论话题。请注意：\n' +
      '- 话题应该简洁明了，能概括核心内容。\n' +
      '- 每个话题请给出主要的参与者。\n' +
      '- 请以 JSON 格式返回，格式为：`[{"topic": "话题1", "contributors": ["用户A", "用户B"], "detail": "话题详细描述"}, ...]`\n\n' +
      '群聊内容如下：\n{messages}'
    ).role('textarea'),
  }).description('高级设置'),
])

import * as Commands from './commands'
import { AnalysisService } from './service'
import { LLMService } from './llm'
import { RendererService } from './renderer'

// 插件的主体逻辑
export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('group-analysis');

  // 定义数据库模型
  ctx.model.extend('group_analysis_messages', {
    id: 'unsigned',
    guildId: 'string',
    userId: 'string',
    username: 'string',
    messageId: 'string',
    content: 'text',
    timestamp: 'timestamp',
  }, {
    autoInc: true,
  })

  // 检查依赖项
  if (!ctx.puppeteer) {
    ctx.logger.warn('koishi-plugin-puppeteer 未加载，本插件无法正常工作。')
    return
  }

  // 注册服务
  ctx.plugin(AnalysisService, config)
  ctx.plugin(LLMService, config)
  ctx.plugin(RendererService)
  
  // 加载命令
  ctx.plugin(Commands)

  // 监听消息并存入数据库
  ctx.on('message', async (session) => {
    // 过滤条件：必须是群聊消息，内容非空，非机器人自己，非命令
    if (!session.guildId || !session.content || session.selfId === session.userId || session.content.startsWith('/')) {
      return;
    }

    try {
      await ctx.database.create('group_analysis_messages', {
        guildId: session.guildId,
        userId: session.userId,
        username: session.author?.nickname || session.author?.username || session.userId,
        messageId: session.messageId,
        content: session.content,
        timestamp: new Date(session.timestamp),
      })
    } catch (error) {
      logger.warn('数据库写入消息失败:', error);
    }
  });


  // 设置定时任务
  ctx.using(['scheduler'], (_ctx) => {
    const ctx = _ctx as Context & { scheduler: any }

    // 定时分析任务
    if (config.cronSchedule) {
      logger.info(`已设置定时分析任务，CRON 表达式为: ${config.cronSchedule}`);
      
      ctx.scheduler.cron(config.cronSchedule, async () => {
        logger.info('开始执行定时群聊分析任务...');
        if (!config.allowedGroups || config.allowedGroups.length === 0) {
          logger.warn('未配置允许的群组 (allowedGroups)，定时任务无法执行。');
          return;
        }
        
        for (const guildId of config.allowedGroups) {
          try {
            // 注意：这里的 maxMessages 暂时写死，后续可以考虑也做成可配置
            await ctx.analysis.executeAnalysis(guildId, config.cronAnalysisDays, 2000);
          } catch (error) {
            logger.error(`为群组 ${guildId} 执行定时分析时出错:`, error);
          }
        }
        logger.info('定时群聊分析任务执行完毕。');
      });
    }

    // 每日数据清理任务
    logger.info(`已设置每日数据清理任务，将清理 ${config.messageRetentionDays} 天前的数据。`);
    ctx.scheduler.cron('0 3 * * *', async () => { // 每天凌晨3点执行
      const retentionDate = new Date(Date.now() - config.messageRetentionDays * Time.day);
      logger.info(`开始清理数据库中 ${retentionDate.toISOString()} 之前的消息...`);
      try {
        const result = await ctx.database.remove('group_analysis_messages', {
          timestamp: { $lt: retentionDate }
        });
        logger.info(`数据清理完成，共移除 ${result.removed} 条旧消息。`);
      } catch (error) {
        logger.error('执行数据清理任务时出错:', error);
      }
    });
  })

  ctx.logger.info('群聊分析插件已加载！')
}