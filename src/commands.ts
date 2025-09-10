import { Context, h } from 'koishi'
import { AnalysisService } from './service'
import { RendererService } from './renderer'

export const name = 'GroupAnalysisCommands'

// 插件依赖的服务
export const inject = ['analysis', 'renderer']

export function apply(ctx: Context) {
  const logger = ctx.logger('GroupAnalysisCmd');

  ctx.command('群分析 [days:number]', '分析群聊近期活动')
    .option('maxMessages', '-m <count:number> 设置最大分析消息数量', { fallback: 1000 })
    .action(async ({ session, options = {} }, days = 1) => {
      const config = ctx.config;
      if (!session || !session.guildId) {
        return '请在群聊中使用此命令。'
      }

      // 检查是否在允许的群组列表中
      if (config.allowedGroups && config.allowedGroups.length > 0 && !config.allowedGroups.includes(session.guildId)) {
        logger.info(`群组 ${session.guildId} 未被授权，已忽略。`);
        return; // 静默失败，不回复任何消息
      }

      // 先发送一个提示消息，表示任务已开始
      await session.send('👌 分析任务已开始，请稍候...');

      // 异步执行，这样不会阻塞 Koishi 的其他操作
      ctx.analysis.executeAnalysis(session.guildId, days, options.maxMessages || 1000)
        .catch(err => logger.error('执行分析时发生未捕获的错误:', err));

      // 命令立即返回，实际结果由 executeAnalysis 异步发送
      return;
    })
}