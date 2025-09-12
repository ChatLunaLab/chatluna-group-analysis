import { Context, Service, h } from 'koishi'
import { OneBotMessage, UserStats, GroupAnalysisResult, SummaryTopic, UserTitle, GoldenQuote, TokenUsage } from './types'
import { Config } from '.'

declare module 'koishi' {
  interface Context {
    analysis: AnalysisService
  }
}

export class AnalysisService extends Service {
  static readonly inject = ['llm', 'renderer']

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'analysis', true)
  }

  public async getGroupHistory(guildId: string, days: number): Promise<OneBotMessage[]> {
    const logger = this.ctx.logger('AnalysisService:getGroupHistory');
    logger.info(`开始为群组 ${guildId} 获取近 ${days} 天的消息记录...`);

    const bot = this.ctx.bots.find(b => b.platform === 'onebot');
    if (!bot) {
      logger.error('没有可用的 OneBot 实例。');
      return [];
    }

    const messages: OneBotMessage[] = [];
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);
    startTime.setHours(0, 0, 0, 0);

    let messageSeq: number = 0;
    let queryRounds = 0;
    let consecutiveFailures = 0;
    const maxFailures = 3; // 连续失败3次则停止

    const maxRounds = 50;
    const maxMessages = this.config.maxMessages;

    while (messages.length < maxMessages && queryRounds < maxRounds) {
      try {
        // 参考 AstrBot 的 Napcat / OneBot V11 调用方式：直接传递参数键值，不嵌套 group_id
        // HACK: 直接调用 internal._get 以确保参数结构正确，避免 adapter 的自动转换问题
        const result: any = await (bot as any).internal._get('get_group_msg_history', {
          group_id: Number(guildId),
          message_seq: messageSeq || 0,
        });

        if (!result || !result.messages?.length) {
          logger.info(`群 ${guildId} 没有更多消息。`);
          break;
        }

        consecutiveFailures = 0;
        const roundMessages: OneBotMessage[] = result.messages;
        const oldestMsg: OneBotMessage = roundMessages[roundMessages.length - 1];
        queryRounds++; // 只有在成功获取后才增加轮数
        
        logger.info(`群 ${guildId} [第 ${queryRounds} 轮] 获取了 ${roundMessages.length} 条消息。最旧消息: ${new Date(oldestMsg.time * 1000).toLocaleString()}`);

        messages.push(...roundMessages.map((msg: OneBotMessage) => ({
          ...msg,
          raw_message: msg.raw_message || '',
        })));

        if (new Date(oldestMsg.time * 1000) < startTime) {
          logger.info(`群 ${guildId} 已获取到时间范围外的消息。`);
          break;
        }

        // 将 message_seq 设置为当前批次中最旧的消息 ID，为下一次迭代做准备
        messageSeq = oldestMsg.message_id;
        
        await new Promise(res => setTimeout(res, this.config.apiCallDelay || 800)); // 避免请求过快

      } catch (err) {
        logger.error(`群 ${guildId} 获取消息失败（第 ${queryRounds + 1} 轮）:`, err);
        if (++consecutiveFailures >= maxFailures) {
          logger.error(`群 ${guildId} 连续失败次数过多，停止获取。`);
          break;
        }
        await new Promise(res => setTimeout(res, 3000));
      }
    }
    
    const finalMessages = messages
      .filter(msg => new Date(msg.time * 1000) >= startTime)
      .filter(msg => String(msg.sender?.user_id) !== String(bot.selfId));

    logger.info(`成功从 API 获取到 ${messages.length} 条原始消息，过滤后剩余 ${finalMessages.length} 条。`);
    return finalMessages;
  }

  public async executeAnalysis(guildId: string, days: number, outputFormat?: 'image' | 'pdf' | 'text') {
    const logger = this.ctx.logger('AnalysisTask');
    await this.ctx.bots.find(b => b.platform === 'onebot')?.sendMessage(guildId, `🔍 开始分析群聊近 ${days} 天的活动，请稍候...`);

    try {
      const messages = await this.getGroupHistory(guildId, days);

      if (messages.length < this.config.minMessages) {
        await this.ctx.bots.find(b => b.platform === 'onebot')?.sendMessage(guildId, `❌ 消息数量不足（${messages.length}条），至少需要 ${this.config.minMessages} 条消息才能进行有效分析。`);
        return;
      }
      
      await this.ctx.bots.find(b => b.platform === 'onebot')?.sendMessage(guildId, `📊 已获取 ${messages.length} 条消息，正在进行智能分析...`);

      const analysisResult = await this.analyzeMessages(messages, guildId);
      if (this.config.debug) {
        logger.debug('Analysis result:', JSON.stringify(analysisResult, null, 2));
      }
      
      const format = outputFormat || this.config.outputFormat || 'image';
      const bot = this.ctx.bots.find(b => b.platform === 'onebot');
      if (!bot) {
        logger.error('没有可用的 OneBot 实例来发送消息。');
        return;
      }

      if (format === 'image') {
        const image = await this.ctx.renderer.render(analysisResult);
        await bot.sendMessage(guildId, typeof image === 'string' ? image : h.image(image, 'image/png'));
      } else if (format === 'pdf') {
        const pdfBuffer = await this.ctx.renderer.renderPdf(analysisResult);
        await bot.sendMessage(guildId, pdfBuffer ? h.file(pdfBuffer, 'application/pdf') : 'PDF 生成失败，请检查日志。');
      } else {
        await bot.sendMessage(guildId, this.generateTextReport(analysisResult));
      }
    } catch (error) {
      logger.error(`为群组 ${guildId} 执行分析任务时发生错误:`, error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await this.ctx.bots.find(b => b.platform === 'onebot')?.sendMessage(guildId, `❌ 分析失败: ${errorMessage}。请检查网络连接和LLM配置，或联系管理员。`);
    }
  }

  public async executeAutoAnalysisForEnabledGroups() {
    if (!this.ctx.database) return;
    const enabledGroups = await this.ctx.database.get('group_analysis_settings', { enabled: true });
    for (const group of enabledGroups) {
      try {
        await this.executeAnalysis(group.guildId, this.config.cronAnalysisDays);
      } catch (err) {
        this.ctx.logger.error(`群 ${group.guildId} 自动分析失败:`, err);
      }
    }
  }

  private generateTextReport(result: GroupAnalysisResult): string {
    let report = `📊 群聊分析报告 (${result.analysisDate})\n`;
    report += `群组: ${result.groupName}\n\n`;
    report += `总消息: ${result.totalMessages} | 参与人数: ${result.totalParticipants} | 总字数: ${result.totalChars} | 表情: ${result.emojiCount}\n`;
    report += `最活跃时段: ${result.mostActivePeriod}\n\n`;

    report += `💬 热门话题:\n`;
    if (result.topics?.length) {
      result.topics.forEach(t => {
        report += `- ${t.topic} (参与者: ${t.contributors.join(', ')})\n  ${t.detail}\n`;
      });
    } else {
      report += '无明显话题\n';
    }

    report += `\n🏆 群友称号:\n`;
    if (result.userTitles?.length) {
      result.userTitles.forEach(t => {
        report += `- ${t.name}: ${t.title} ${t.mbti && t.mbti !== 'N/A' ? `(${t.mbti})` : ''} - ${t.reason}\n`;
      });
    } else {
      report += '无特殊称号\n';
    }

    report += `\n💬 群圣经:\n`;
    if (result.goldenQuotes?.length) {
      result.goldenQuotes.forEach(q => {
        report += `- "${q.content}" —— ${q.sender}\n  理由: ${q.reason}\n`;
      });
    } else {
      report += '无金句记录\n';
    }
    
    report += `\nToken Usage: ${result.tokenUsage.totalTokens}`

    return report;
  }

  private _calculateBasicStats(messages: OneBotMessage[]) {
    const userStats: Record<number, UserStats> = {};
    let totalChars = 0;
    let totalEmojiCount = 0;
    const allMessagesText: string[] = [];

    const getInitialUserStats = (msg: OneBotMessage): UserStats => ({
      userId: msg.sender.user_id,
      nickname: msg.sender.nickname,
      messageCount: 0,
      charCount: 0,
      lastActive: new Date(0),
      replyCount: 0,
      atCount: 0,
      emojiStats: {},
      nightRatio: 0,
      avgChars: 0,
      replyRatio: 0,
      nightMessages: 0,
      activeHours: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 0])),
    });

    for (const msg of messages) {
      const userId = msg.sender.user_id;
      if (!userId) continue;

      if (!userStats[userId]) {
        userStats[userId] = getInitialUserStats(msg);
      }
      
      const stat = userStats[userId];
      stat.messageCount++;
      stat.charCount += msg.raw_message.length;
      stat.lastActive = new Date(Math.max(stat.lastActive.getTime(), msg.time * 1000));
      totalChars += msg.raw_message.length;

      const hour = new Date(msg.time * 1000).getHours();
      stat.activeHours[hour]++;
      if (hour >= 0 && hour < 6) {
        stat.nightMessages++;
      }
      
      const elements = h.parse(msg.raw_message);
      let pureText = '';
      for (const el of elements) {
        if (el.type === 'text') {
          pureText += el.attrs.content;
        } else if (el.type === 'quote') {
          stat.replyCount++;
        } else if (el.type === 'at') {
          stat.atCount++;
        } else if (el.type === 'face') {
          stat.emojiStats['face'] = (stat.emojiStats['face'] || 0) + 1;
          totalEmojiCount++;
        } else if (el.type === 'image' && el.attrs.type === 'sticker') { // OneBot v11 may use this for stickers
          stat.emojiStats['sticker'] = (stat.emojiStats['sticker'] || 0) + 1;
          totalEmojiCount++;
        }
      }
      if (pureText) {
        allMessagesText.push(`${msg.sender.nickname}: ${pureText.trim()}`);
      }
    }
    
    // Calculate derived stats
    for (const userId in userStats) {
      const stat = userStats[userId];
      stat.avgChars = stat.messageCount > 0 ? parseFloat((stat.charCount / stat.messageCount).toFixed(1)) : 0;
      stat.nightRatio = stat.messageCount > 0 ? parseFloat((stat.nightMessages / stat.messageCount).toFixed(2)) : 0;
      stat.replyRatio = stat.messageCount > 0 ? parseFloat((stat.replyCount / stat.messageCount).toFixed(2)) : 0;
    }

    return { userStats, totalChars, totalEmojiCount, allMessagesText };
  }

  public async analyzeMessages(messages: OneBotMessage[], guildId: string): Promise<GroupAnalysisResult> {
    this.ctx.logger.info(`开始分析 ${messages.length} 条消息...`);

    const { userStats, totalChars, totalEmojiCount, allMessagesText } = this._calculateBasicStats(messages);
    
    const messagesText = allMessagesText.join('\n');
    let totalTokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const accumulateTokens = (usage: TokenUsage) => {
      totalTokenUsage.promptTokens += usage.promptTokens;
      totalTokenUsage.completionTokens += usage.completionTokens;
      totalTokenUsage.totalTokens += usage.totalTokens;
    };

    // LLM analyses in parallel
    const users = Object.values(userStats);

    const [
      { result: topics, tokenUsage: topicTokens },
      { result: userTitles, tokenUsage: titleTokens },
      { result: goldenQuotes, tokenUsage: quoteTokens },
    ] = await Promise.all([
      this.ctx.llm.summarizeTopics(messagesText),
      this.config.userTitleAnalysis
        ? this.ctx.llm.analyzeUserTitles(users)
        : Promise.resolve({ result: [] as UserTitle[], tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
      this.ctx.llm.analyzeGoldenQuotes(messagesText, this.config.maxGoldenQuotes),
    ]).catch((error: any) => {
      this.ctx.logger.error('LLM analysis failed:', error);
      //  On LLM failure, return empty results to avoid crashing the entire analysis.
      const emptyTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const emptyResult: [
        { result: SummaryTopic[]; tokenUsage: TokenUsage },
        { result: UserTitle[]; tokenUsage: TokenUsage },
        { result: GoldenQuote[]; tokenUsage: TokenUsage },
      ] = [
        { result: [], tokenUsage: emptyTokenUsage },
        { result: [], tokenUsage: emptyTokenUsage },
        { result: [], tokenUsage: emptyTokenUsage },
      ];
      return emptyResult;
    });

    accumulateTokens(topicTokens);
    accumulateTokens(titleTokens);
    accumulateTokens(quoteTokens);

    // Final statistics
    const sortedUsers = users.sort((a, b) => b.messageCount - a.messageCount);
    const overallActiveHours = users.reduce((acc, user) => {
      for (const hour in user.activeHours) {
        acc[hour] = (acc[hour] || 0) + user.activeHours[hour];
      }
      return acc;
    }, {} as Record<number, number>);
    const mostActiveHourEntry = Object.entries(overallActiveHours).sort((a, b) => b[1] - a[1])[0];
    const mostActiveHour = mostActiveHourEntry ? mostActiveHourEntry[0] : 'N/A';
    const activeHoursChartHtml = this._generateChartHtml(overallActiveHours);
    
    const bot = this.ctx.bots.find(b => b.platform === 'onebot');
    let groupName = guildId;
    if (bot) {
      try {
        groupName = (await bot.getGuild(guildId)).name || guildId;
      } catch (err) {
        this.ctx.logger('AnalysisService').warn(`获取群组 ${guildId} 名称失败: ${err}`);
      }
    }

    const result: GroupAnalysisResult = {
      totalMessages: messages.length,
      totalChars,
      totalParticipants: users.length,
      emojiCount: totalEmojiCount,
      mostActiveUser: sortedUsers[0] || null,
      mostActivePeriod: mostActiveHour !== 'N/A' ? `${mostActiveHour.padStart(2, '0')}:00 - ${String(parseInt(mostActiveHour) + 1).padStart(2, '0')}:00` : 'N/A',
      userStats: sortedUsers.slice(0, this.config.maxUsersInReport),
      topics,
      userTitles,
      goldenQuotes,
      activeHoursChart: activeHoursChartHtml,
      analysisDate: new Date().toLocaleDateString('zh-CN'),
      groupName: groupName,
      tokenUsage: totalTokenUsage
    };

    this.ctx.logger.info('消息分析完成。');
    return result;
  }

  private _generateChartHtml(activeHours: Record<number, number>): string {
    const maxCount = Math.max(...Object.values(activeHours), 1);
    let html = '';
    for (let i = 0; i < 24; i++) {
      const count = activeHours[i] || 0;
      const height = (count / maxCount) * 100;
      html += `<div class="activity-bar">
                <div class="activity-bar-bar" style="height: ${height}%;"></div>
                <span class="activity-bar-label">${String(i).padStart(2, '0')}</span>
              </div>`;
    }
    return html;
  }
}