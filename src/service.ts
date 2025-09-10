import { Context, Service, h } from 'koishi'
import { OneBotMessage, UserStats, GroupAnalysisResult, SummaryTopic, GroupMessage } from './types'
import { Config } from '.'

// 扩展 Context 类型，告诉 TypeScript ctx.analysis 的存在
declare module 'koishi' {
  interface Context {
    analysis: AnalysisService
  }
}

export class AnalysisService extends Service {
  static readonly inject = ['llm', 'renderer', 'database']

  constructor(ctx: Context, public config: Config) {
    // Service 的构造函数会自动将服务实例挂载到 ctx.analysis
    super(ctx, 'analysis', true)
  }

  public async getGroupHistory(guildId: string, days: number, maxMessages: number): Promise<OneBotMessage[]> {
    const logger = this.ctx.logger('AnalysisService');
    logger.info(`开始通过 OneBot API 为群组 ${guildId} 获取近 ${days} 天的消息记录...`);

    // 修改为当日 0:00 到 24:00 的时间范围
    const now = new Date();
    const startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const bot = this.ctx.bots[0];
    if (!bot) {
      logger.error('没有可用的 Bot 实例来获取消息。');
      return [];
    }

    const messages: OneBotMessage[] = [];
    let messageSeq = 0;
    let queryRounds = 0;
    const maxRounds = 50;
    let consecutiveFailures = 0;
    const maxFailures = 3;

    // 移除 batchLimit 限制，获取当天所有
    while (queryRounds < maxRounds) {
      try {
        const payload = {
          group_id: guildId,
          message_seq: messageSeq,
          count: 200, // 每次API调用最大200条
          reverseOrder: true,
        };
        const result = await bot.internal.getGroupMsgHistory(Number(guildId), messageSeq);
        if (!result || !result.messages) {
          logger.warn(`群 ${guildId} API 返回无效结果: ${JSON.stringify(result)}`);
          if (++consecutiveFailures >= maxFailures) break;
          continue;
        }
        const roundMessages = result.messages;
        if (roundMessages.length === 0) {
          logger.info(`群 ${guildId} 没有更多消息，结束获取。`);
          break;
        }
        consecutiveFailures = 0;
        let oldestMsgTime: Date | null = null;
        for (const msg of roundMessages) {
          const msgTime = new Date(msg.time * 1000);
          oldestMsgTime = msgTime;
          if (msgTime < startTime || msgTime > endTime) continue;
          // 屏蔽机器人自身的消息
          if (String(msg.sender?.user_id) === String(bot.selfId)) continue;
          if (msg.sender?.user_id === bot.selfId) continue;
          messages.push({
            message_id: msg.message_id,
            message_seq: msg.message_id,
            time: msg.time,
            message: msg.message,
            raw_message: msg.raw_message || '',
            sender: {
              user_id: msg.sender?.user_id,
              nickname: msg.sender?.nickname || '',
            },
          });
        }
        if (oldestMsgTime && oldestMsgTime < startTime) {
          logger.info(`群 ${guildId} 已获取到时间范围外的消息，停止获取。总共获取 ${messages.length} 条。`);
          break;
        }
        messageSeq = roundMessages[0].message_id;
        queryRounds++;
      } catch (err) {
        logger.error(`群 ${guildId} 获取消息失败（第${queryRounds + 1}轮）:`, err);
        if (++consecutiveFailures >= maxFailures) break;
        await new Promise(res => setTimeout(res, 1000));
      }
    }
    logger.info(`成功从 API 获取到 ${messages.length} 条消息。`);
    return messages;
  }

  public async executeAnalysis(guildId: string, days: number, maxMessages: number) {
    const logger = this.ctx.logger('AnalysisTask');
    logger.info(`开始为群组 ${guildId} 执行分析任务...`);

    try {
      const messages = await this.getGroupHistory(guildId, days, maxMessages);

      if (messages.length === 0) {
        logger.info(`群组 ${guildId} 在指定时间范围内没有找到任何消息。`);
        // 对于定时任务，没有消息就不发送
        return;
      }

      logger.info(`为群组 ${guildId} 成功获取 ${messages.length} 条消息，正在分析...`);

      const analysisResult = await this.analyzeMessages(messages);
      if (this.config.debug) {
        logger.debug('Analysis result:', JSON.stringify(analysisResult, null, 2));
      }
      
      logger.info(`为群组 ${guildId} 分析完成，正在生成报告图片...`);

      const image = await this.ctx.renderer.render(analysisResult);

      if (typeof image === 'string') {
        logger.error(`为群组 ${guildId} 渲染图片失败: ${image}`);
        return;
      }
      
      const bot = this.ctx.bots[0];
      if (!bot) {
        logger.error('没有可用的 Bot 实例来发送消息。');
        return;
      }
      
      // 使用 bot.sendMessage 发送，因为它不依赖于特定的 session
      // 使用 Koishi 官方推荐的 h.image 发送图片（二进制 Buffer 或 base64 都可），确保发送协议正确
      const imgMsg = h.image(image, 'image/png')
      await bot.sendMessage(guildId, imgMsg)
      logger.info(`成功为群组 ${guildId} 发送了分析报告。`);

    } catch (error) {
      logger.error(`为群组 ${guildId} 执行分析任务时发生错误:`, error);
    }
  }

  public async analyzeMessages(messages: OneBotMessage[]): Promise<GroupAnalysisResult> {
    this.ctx.logger.info(`开始分析 ${messages.length} 条消息...`)
    const userStats: Record<number, UserStats> = {};
    
    // 用于生成群友称号的容器
    // 群友称号数据（替代 userStats 模块）
    const memberTitles: any[] = [];
    
    // 用于生成群圣经（金句）的容器
    const groupBible: any[] = [];
    let totalChars = 0;
    const activeHours: Record<number, number> = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, 0]));
    const emojiRegex = /\[CQ:face,id=\d+\]/g;
    let emojiCount = 0;
    const allMessagesText: string[] = [];


    for (const msg of messages) {
      // 只处理纯文本和CQ表情，过滤掉图片、文件等
      if (msg.raw_message && !msg.raw_message.includes('[CQ:image,') && !msg.raw_message.includes('[CQ:record,')) {
        allMessagesText.push(`${msg.sender.nickname}: ${msg.raw_message}`);
      }
      
      const userId = msg.sender.user_id;
      if (!userId) continue;
      
      // 初始化用户统计
      if (!userStats[userId]) {
        userStats[userId] = {
          userId: userId,
          nickname: msg.sender.nickname,
          messageCount: 0,
          charCount: 0,
          lastActive: new Date(0),
        };
      }

      // 更新统计数据
      userStats[userId].messageCount++;
      userStats[userId].charCount += msg.raw_message.length;
      userStats[userId].lastActive = new Date(Math.max(userStats[userId].lastActive.getTime(), msg.time * 1000));
      totalChars += msg.raw_message.length;

      // 统计表情
      const emojis = msg.raw_message.match(emojiRegex);
      if (emojis) {
        emojiCount += emojis.length;
      }
      
            // 统计活跃时段
            const hour = new Date(msg.time * 1000).getHours();
            activeHours[hour]++;
            
            // 群圣经筛选逻辑（去掉异常字符，限6条，过滤奇怪Unicode）
            const cleanMsg = msg.raw_message
              // 移除[?]占位符
              .replace(/\[\?\]/g, '')
              // 移除常见emoji字符
              .replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
              // 移除SVG标签
              .replace(/<svg[^>]*>.*?<\/svg>/gis, '')
              // 移除img标签
              .replace(/<img[^>]*>/gi, '')
              // 移除非法控制字符
              .replace(/[\uFFFD\u0000-\u001F]+/g, '')
              .trim()
            if (cleanMsg && cleanMsg.length > 15 && !cleanMsg.includes('[CQ:')) {
              groupBible.push({
                content: cleanMsg,
                sender: msg.sender.nickname || String(msg.sender.user_id),
                reason: '高质量消息'
              });
              if (groupBible.length >= 6) {
                break
              }
            }
    }

    // 调用 LLM 服务进行话题分析
    let topics: SummaryTopic[] = [];
    if (this.config.model && allMessagesText.length > 0) {
      topics = await this.ctx.llm.summarizeTopics(allMessagesText.join('\n'));
    }

    // 生成简单的群友称号逻辑：按消息数排名前3的用户赋予称号
    const sortedUsers = Object.values(userStats).sort((a, b) => b.messageCount - a.messageCount);
    const bot = this.ctx.bots[0]
    const fetchBase64Image = async (url: string) => {
      try {
        const res = await fetch(url)
        const buffer = await res.arrayBuffer()
        return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`
      } catch (e) {
        this.ctx.logger('AnalysisService').warn(`获取图片失败 ${url}: ${e}`)
        return ''
      }
    }

    // 基于 astrbot 逻辑扩展的群友称号生成（前4名，多种称号）
    const titleRules = [
      { title: '话痨王', reason: '消息数量位列前茅', sortKey: (u: UserStats) => u.messageCount },
      { title: '文字狂魔', reason: '总字数遥遥领先', sortKey: (u: UserStats) => u.charCount },
      { title: '摸鱼达人', reason: '总活跃时段最广', sortKey: (u: UserStats) => -Math.abs(u.lastActive.getTime() - Date.now()) },
      { title: '表情帝', reason: '表情使用最多', sortKey: (u: UserStats) => {
        const text = allMessagesText.filter(m => m.startsWith(`${u.nickname}:`)).join('')
        return (text.match(emojiRegex)?.length) || 0
      }},
    ]
    const topUsers = sortedUsers.slice(0, 10) // 候选池
    let assignedCount = 0
    for (const rule of titleRules) {
      if (assignedCount >= 4) break
      const candidate = [...topUsers].sort((a, b) => rule.sortKey(b) - rule.sortKey(a))[0]
      if (!candidate) continue
      let avatarUrl: string | undefined
      try {
        if (bot?.getUser) {
          const userInfo = await bot.getUser(String(candidate.userId))
          avatarUrl = userInfo.avatar
        }
      } catch (err) {
        this.ctx.logger('AnalysisService').warn(`获取用户 ${candidate.userId} 头像失败: ${err}`)
      }
      avatarUrl ||= `https://q4.qlogo.cn/headimg_dl?dst_uin=${candidate.userId}&spec=640`
      let avatarBase64 = ''
      try {
        const res = await fetch(avatarUrl)
        const buffer = Buffer.from(await res.arrayBuffer())
        avatarBase64 = `data:image/png;base64,${buffer.toString('base64')}`
      } catch (err) {
        this.ctx.logger('AnalysisService').warn(`下载用户 ${candidate.userId} 头像失败: ${err}`)
      }
      memberTitles.push({
        name: candidate.nickname,
        title: rule.title,
        mbti: 'N/A',
        reason: rule.reason,
        avatar: avatarBase64
      })
      assignedCount++
    }

    // 给热门话题与群友称号前添加外部SVG图标（base64内联）
    const fs = await import('fs');
    const path = await import('path');
    const svgToBase64 = (p: string) => {
      try {
        const svgPath = path.resolve(__dirname, '../24', p);
        const svgData = fs.readFileSync(svgPath, 'utf-8');
        return `data:image/svg+xml;base64,${Buffer.from(svgData).toString('base64')}`;
      } catch (err) {
        this.ctx.logger('AnalysisService').warn(`读取SVG失败 ${p}: ${err}`);
        return '';
      }
    };
    if (topics?.length) {
      const fireIcon = svgToBase64('outline/fire.svg');
      for (const topic of topics) {
        (topic as any).icon = fireIcon;
      }
    }
    if (memberTitles?.length) {
      const capIcon = svgToBase64('outline/academic-cap.svg');
      for (const mt of memberTitles) {
        (mt as any).icon = capIcon;
      }
    }
    // 找到最活跃的时段
    const mostActiveHourEntry = Object.entries(activeHours).sort((a, b) => b[1] - a[1])[0];
    const mostActiveHour = mostActiveHourEntry ? mostActiveHourEntry[0] : 'N/A';
    
    const result: GroupAnalysisResult = {
      totalMessages: messages.length,
      totalChars: totalChars,
      totalParticipants: Object.keys(userStats).length,
      emojiCount: emojiCount,
      mostActiveUser: sortedUsers[0] || null,
      mostActivePeriod: mostActiveHour !== 'N/A' ? `${mostActiveHour.padStart(2, '0')}:00 - ${mostActiveHour.padStart(2, '0')}:59` : 'N/A',
      userStats: [], // 移除用户统计部分
      topics: topics,
      memberTitles,
      groupBible,
    };

    this.ctx.logger.info('消息分析完成。')
    return result;
  }
}