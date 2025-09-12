import { Context, h } from 'koishi'
import { AnalysisService } from './service'
import { RendererService } from './renderer'

export const name = 'group-analysis-commands'

// 插件依赖的服务
export const inject = ['analysis', 'database']

declare module 'koishi' {
  interface Context {
    analysis: AnalysisService
    renderer: RendererService
  }
}

export function apply(ctx: Context) {
  const logger = ctx.logger('group-analysis-cmd');
  logger.info('正在加载群分析命令...');

  ctx.command('群分析 [days:number]', '分析本群的近期聊天记录', { authority: 1 })
    .alias('qunfenxi')
    .action(async ({ session }, days) => {
      if (!session?.guildId) return '请在群聊中使用此命令。'
      
      const analysisDays = days || ctx.config.cronAnalysisDays;
      if (analysisDays > 7) return '出于性能考虑，最多只能分析 7 天的数据。'

      await session.send('👌 分析任务已开始，请稍候...');

      ctx.analysis.executeAnalysis(session.guildId, analysisDays)
        .catch(err => logger.error('执行分析时发生未捕获的错误:', err));
      
      return;
    });

  const settings = ctx.command('分析设置', '管理群聊分析功能', { authority: 3 });

  settings.subcommand('.enable', '启用本群的分析功能')
    .action(async ({ session }) => {
      if (!session?.guildId) return '请在群聊中使用此命令。'
      if (!ctx.database) return '数据库服务未启用。'
      await ctx.database.upsert('group_analysis_settings', [{ guildId: session.guildId, enabled: true }], 'guildId');
      return '✅ 已为当前群启用日常分析功能。'
    });

  settings.subcommand('.disable', '禁用本群的分析功能')
    .action(async ({ session }) => {
      if (!session?.guildId) return '请在群聊中使用此命令。'
      if (!ctx.database) return '数据库服务未启用。'
      await ctx.database.upsert('group_analysis_settings', [{ guildId: session.guildId, enabled: false }], 'guildId');
      return '✅ 已为当前群禁用日常分析功能。'
    });

  settings.subcommand('.status', '查看当前分析设置')
    .action(async ({ session }) => {
      if (!session?.guildId) return '请在群聊中使用此命令。'
      if (!ctx.database) return '数据库服务未启用。'
      const setting = await ctx.database.get('group_analysis_settings', { guildId: session.guildId });
      const enabled = setting[0]?.enabled ? '已启用' : '未启用';
      return `📊 当前群分析功能状态: ${enabled}`;
    });
}