import { Context, Service, h } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { GroupAnalysisResult, UserStats, SummaryTopic, GoldenQuote, UserTitle } from './types'

// 扩展 Context 类型
declare module 'koishi' {
  interface Context {
    renderer: RendererService
  }
}

export class RendererService extends Service {
  // 依赖 puppeteer 服务
  static inject = ['puppeteer']

  constructor(ctx: Context) {
    super(ctx, 'renderer', true)
  }

  private getAvatarUrl(userId: number | string): string {
    return `http://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`;
  }

  private formatUserStats(userStats: UserStats[]): string {
    if (!userStats || userStats.length === 0) {
      return '<div class="empty-state">暂无用户统计信息</div>';
    }
    return userStats.map(user => `
      <div class="user-stat-card">
        <img src="${this.getAvatarUrl(user.userId)}" alt="avatar" class="avatar">
        <div class="user-details">
          <div class="nickname">${user.nickname}</div>
          <div class="stats-grid">
            <span>发言数: <strong>${user.messageCount}</strong></span>
            <span>字数: <strong>${user.charCount}</strong></span>
            <span>回复率: <strong>${(user.replyRatio * 100).toFixed(0)}%</strong></span>
            <span>夜猫子: <strong>${(user.nightRatio * 100).toFixed(0)}%</strong></span>
          </div>
        </div>
      </div>
    `).join('');
  }

  private formatGoldenQuotes(quotes: GoldenQuote[]): string {
    if (!quotes || quotes.length === 0) {
      return '<div class="empty-state">本次未发现逆天神人发言</div>';
    }
    return quotes.map(quote => `
      <div class="quote-card">
        <div class="quote-content">“${quote.content}”</div>
        <div class="quote-footer">
          <span class="quote-sender">— ${quote.sender}</span>
          <p class="quote-reason"><strong>逆天理由:</strong> ${quote.reason}</p>
        </div>
      </div>
    `).join('');
  }

  private formatUserTitles(userTitles: UserTitle[]): string {
    if (!userTitles || userTitles.length === 0) {
      return '<div class="empty-state">本次无人获得特殊称号</div>';
    }
    return userTitles.map(title => `
      <div class="title-card">
        <img src="${this.getAvatarUrl(title.qq)}" alt="avatar" class="avatar">
        <div class="title-details">
          <div class="nickname">${title.name}</div>
          <div class="title-badge">${title.mbti && title.mbti !== 'N/A' ? `${title.title} | ${title.mbti}` : title.title}</div>
          <p class="title-reason">${title.reason}</p>
        </div>
      </div>
    `).join('');
  }

  private formatTopics(topics: SummaryTopic[]): string {
    if (!topics || topics.length === 0) {
      return '<div class="empty-state">本次无明显讨论话题</div>';
    }
    return topics.map((topic: SummaryTopic) => `
      <div class="topic-card">
        <div class="topic-title">${topic.topic}</div>
        <div class="topic-contributors">主要参与者: ${topic.contributors.join(', ')}</div>
        <p class="topic-detail">${topic.detail}</p>
      </div>
    `).join('');
  }
   

  public async renderPdf(data: GroupAnalysisResult): Promise<Buffer> {
    if (!this.ctx.puppeteer) {
      throw new Error('Puppeteer service is not available.');
    }

    const html = await this.renderHtml(data);
    const page = await this.ctx.puppeteer.page();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4' });
    await page.close();
    return pdfBuffer;
  }

  private async renderHtml(data: GroupAnalysisResult): Promise<string> {
    const templatePath = path.resolve(__dirname, './report.html');
    const filledHtml = (await fs.readFile(templatePath, 'utf-8'))
      .replace('{{groupName}}', data.groupName)
      .replace('{{analysisDate}}', data.analysisDate)
      .replace('{{totalMessages}}', data.totalMessages.toString())
      .replace('{{totalParticipants}}', data.totalParticipants.toString())
      .replace('{{totalChars}}', data.totalChars.toString())
      .replace('{{mostActivePeriod}}', data.mostActivePeriod)
      .replace('{{userStats}}', this.formatUserStats(data.userStats))
      .replace('{{topics}}', this.formatTopics(data.topics || []))
      .replace('{{userTitles}}', this.formatUserTitles(data.userTitles || []))
      .replace('{{activeHoursChart}}', data.activeHoursChart || '')
      .replace('{{goldenQuotes}}', this.formatGoldenQuotes(data.goldenQuotes || []))
      .replace('{{tokenUsage}}', data.tokenUsage.totalTokens.toString());
    return filledHtml;
  }

  public async render(data: GroupAnalysisResult): Promise<Buffer | string> {
    try {
      // 检查 puppeteer 是否可用
      if (!this.ctx.puppeteer) {
        throw new Error('Puppeteer service is not available.');
      }

      const filledHtml = await this.renderHtml(data);

      this.ctx.logger.info('HTML 模板填充完成，正在调用 Puppeteer 进行渲染...');

      const page = await this.ctx.puppeteer.page();

      // 使用 setContent 避免 Data URI 过长的问题
      await page.setContent(filledHtml, { waitUntil: 'networkidle0' });

      // 找到页面中的 container 元素
      const element = await page.$('.container');
      if (!element) {
        await page.close();
        throw new Error('无法在渲染的 HTML 中找到 .container 元素。');
      }

      const imageBuffer = await element.screenshot();
      await page.close();

      this.ctx.logger.info('图片渲染成功！');
      return imageBuffer;

    } catch (error) {
      this.ctx.logger.error('渲染报告图片时发生错误:', error);
      if (error instanceof Error) {
        return `图片渲染失败: ${error.message}`;
      }
      return '图片渲染失败，发生未知错误。';
    }
  }
}