import { Context, Service, h } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { GroupAnalysisResult, UserStats, SummaryTopic } from './types'

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

  private formatUserStats(userStats: UserStats[]): string {
    if (!userStats || userStats.length === 0) {
      return '<li>暂无用户统计信息</li>';
    }
    return userStats.map(user => `
      <li>
        <div class="user-info">
          <img src="${user.avatar}" alt="头像" style="width:40px;height:40px;border-radius:50%;margin-right:10px;">
          <div class="details">
            <div class="nickname">${user.nickname}</div>
            <div class="message-count">消息数: ${user.messageCount}</div>
          </div>
        </div>
      </li>
    `).join('');
  }

  private formatGroupBible(quotes: any[]): string {
    if (!quotes || quotes.length === 0) {
      return '<li>暂无群圣经</li>';
    }
    return quotes.map(quote => `
      <li>
        <div class="topic-title">"${quote.content}"</div>
        <div class="topic-contributors">—— ${quote.sender}</div>
        <div class="topic-detail">${quote.reason}</div>
      </li>
    `).join('');
  }

  private formatMemberTitles(memberTitles: any[]): string {
    if (!memberTitles || memberTitles.length === 0) {
      return '<li>暂无群友称号</li>';
    }
    return memberTitles.map(title => `
      <li>
        <div class="user-info">
          <img src="${title.avatar}" alt="头像" style="width:40px;height:40px;border-radius:50%;margin-right:10px;">
          <div class="details">
            <div class="nickname">${title.name}</div>
            <div class="message-count">${title.mbti && title.mbti !== 'N/A' ? `${title.title} | ${title.mbti}` : title.title}</div>
          </div>
        </div>
        <div class="topic-detail">${title.reason}</div>
      </li>
    `).join('');
  }

  private formatTopics(topics: any[]): string {
    if (!topics || topics.length === 0) {
      return '<li>本次无明显话题</li>';
    }
    return (topics as SummaryTopic[]).map((topic: SummaryTopic) => `
      <li>
        <div class="topic-title">${topic.topic}</div>
        <div class="topic-contributors">主要贡献者: ${topic.contributors.join(', ')}</div>
        <div class="topic-detail">${topic.detail}</div>
      </li>
    `).join('');
  }
   

  public async render(data: GroupAnalysisResult): Promise<Buffer | string> {
    try {
      // 检查 puppeteer 是否可用
      if (!this.ctx.puppeteer) {
        throw new Error('Puppeteer service is not available.');
      }

      const templatePath = path.resolve(__dirname, './report.html');
      // 读取 msyh.ttf 并转换为 base64
      const fontPath = path.resolve(__dirname, '../lib/msyh.ttf');
      let base64Font = '';
      try {
        const fontBuffer = await fs.readFile(fontPath);
        base64Font = fontBuffer.toString('base64');
        this.ctx.logger.info(`字体文件已加载: ${fontPath}`);
      } catch (err) {
        this.ctx.logger.warn(`字体文件加载失败: ${fontPath}，将使用系统默认字体。`);
      }

      const filledHtml = (await fs.readFile(templatePath, 'utf-8'))
        .replace('{{totalMessages}}', data.totalMessages.toString())
        .replace('{{totalParticipants}}', data.totalParticipants.toString())
        .replace('{{totalChars}}', data.totalChars.toString())
        .replace('{{mostActivePeriod}}', data.mostActivePeriod)
        .replace('{{userStats}}', this.formatUserStats(data.userStats))
        .replace('{{topics}}', this.formatTopics(data.topics))
        .replace('{{memberTitles}}', this.formatMemberTitles(data.memberTitles || []))
        .replace('{{groupBible}}', this.formatGroupBible(data.groupBible || []))
        .replace('{{embeddedFont}}', base64Font || '');

      this.ctx.logger.info('HTML 模板填充完成，正在调用 Puppeteer 进行渲染...');

      const page = await this.ctx.puppeteer.page();

      // 将 HTML 字符串转换为 Base64（字体不直接注入 HTML，而是在 Puppeteer 中注入）
      const base64Html = Buffer.from(filledHtml).toString('base64');
      const dataUri = `data:text/html;base64,${base64Html}`;

      // 使用 goto 加载 Data URI
      await page.goto(dataUri, { waitUntil: 'networkidle0' });

      // 在 Puppeteer 中注入字体
      if (base64Font) {
        await page.addStyleTag({
          content: `
            @font-face {
              font-family: 'CustomMSYH';
              src: url(data:font/ttf;base64,${base64Font}) format('truetype');
              font-weight: normal;
              font-style: normal;
            }
            body { font-family: 'CustomMSYH', sans-serif !important; }
          `
        });
      }

      // 使用 goto 加载 Data URI
      await page.goto(dataUri, { waitUntil: 'networkidle0' });

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