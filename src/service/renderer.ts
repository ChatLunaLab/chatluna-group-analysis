import { Context, Service } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { GroupAnalysisResult } from '../types'
import { fileURLToPath } from 'url'
import {
    formatUserStats,
    formatTopics,
    formatUserTitles,
    generateActiveHoursChart,
    formatGoldenQuotes,
    renderTemplate
} from '../utils'

export class RendererService extends Service {
    static inject = ['puppeteer']

    templateDir: string

    constructor(ctx: Context) {
        super(ctx, 'chatluna_group_analysis_renderer', true)

        this.templateDir = path.resolve(
            ctx.baseDir,
            'data/chatluna/group_analysis'
        )

        this.ctx.on('ready', async () => {
            await this.init()
        })
    }

    async init() {
        const dirname =
            __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
        const templateHtmlDir = dirname + '/../resources'

        const templateDir = this.templateDir

        /* try {
            await fs.access(templateDir)
        } catch (error) { */
        await fs.mkdir(templateDir, { recursive: true })
        await fs.cp(templateHtmlDir, templateDir, { recursive: true })
        /*   } */

        const tempHtmlFiles = await fs
            .readdir(templateDir)
            .then((files) =>
                files.filter(
                    (file) =>
                        file.endsWith('.html') && !file.startsWith('template')
                )
            )

        for (const file of tempHtmlFiles) {
            await fs.unlink(path.resolve(templateDir, file))
        }
    }

    public async renderGroupAnalysisToPdf(
        data: GroupAnalysisResult
    ): Promise<Buffer> {
        const page = await this._renderGroupAnalysis(data)

        const pdfBuffer = await page.pdf({ format: 'A4' })
        await page.close()

        return pdfBuffer
    }

    public async renderGroupAnalysis(
        data: GroupAnalysisResult
    ): Promise<Buffer | string> {
        try {
            const page = await this._renderGroupAnalysis(data)

            // 找到页面中的 container 元素
            const element = await page.$('.container')
            if (!element) {
                await page.close()
                throw new Error('无法在渲染的 HTML 中找到 .container 元素。')
            }

            const imageBuffer = await element.screenshot()
            await page.close()

            this.ctx.logger.info('图片渲染成功！')
            return imageBuffer
        } catch (error) {
            this.ctx.logger.error('渲染报告图片时发生错误:', error)
            if (error instanceof Error) {
                return `图片渲染失败: ${error.message}`
            }
            return '图片渲染失败，发生未知错误。'
        }
    }

    private async _renderGroupAnalysis(
        data: GroupAnalysisResult
    ): Promise<Awaited<ReturnType<Context['puppeteer']['page']>>> {
        // 检查 puppeteer 是否可用
        if (!this.ctx.puppeteer) {
            throw new Error('Puppeteer service is not available.')
        }

        const templatePath = path.resolve(
            this.templateDir,
            'template_group.html'
        )
        const randomId = Math.random().toString(36).substring(2, 15)
        const outTemplateHtmlPath = path.resolve(
            this.templateDir,
            `${randomId}.html`
        )

        // 读取模板文件并替换占位符
        const templateHtml = await fs.readFile(templatePath, 'utf-8')
        const filledHtml = renderTemplate(templateHtml, {
            groupName: data.groupName,
            analysisDate: data.analysisDate,
            totalMessages: data.totalMessages.toString(),
            totalParticipants: data.totalParticipants.toString(),
            totalChars: data.totalChars.toString(),
            mostActivePeriod: data.mostActivePeriod,
            userStats: formatUserStats(data.userStats),
            topics: formatTopics(data.topics || []),
            userTitles: formatUserTitles(data.userTitles || []),
            activeHoursChart: generateActiveHoursChart(
                data.activeHoursData || {}
            ),
            goldenQuotes: formatGoldenQuotes(data.goldenQuotes || [])
        })

        // 写入临时 HTML 文件
        await fs.writeFile(outTemplateHtmlPath, filledHtml)

        this.ctx.logger.info(
            'HTML 模板填充完成，正在调用 Puppeteer 进行渲染...'
        )

        const page = await this.ctx.puppeteer.page()

        // 重新加载页面并使用 goto 访问本地文件
        await page.goto('file://' + outTemplateHtmlPath, {
            waitUntil: 'networkidle0',
            timeout: 40 * 1000
        })

        // 等待字体加载完成
        await page.evaluate(() => document.fonts.ready)

        this.ctx.logger.debug('字体加载完成')

        // 设置 3 分钟后自动删除临时文件
        this.ctx.setTimeout(
            async () => {
                try {
                    await fs.unlink(outTemplateHtmlPath)
                    this.ctx.logger.debug(
                        `已删除临时文件: ${outTemplateHtmlPath}`
                    )
                } catch (error) {
                    this.ctx.logger.warn(`删除临时文件失败: ${error}`)
                }
            },
            3 * 60 * 1000
        ) // 3 分钟

        return page
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_renderer: RendererService
    }
}
