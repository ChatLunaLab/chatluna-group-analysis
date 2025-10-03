import { Context, Service } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { GroupAnalysisResult, UserPersonaProfile } from '../types'
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

        const page = await this.ctx.puppeteer.page()

        try {
            await page.goto('file://' + templateDir + '/template_user.html', {
                waitUntil: 'domcontentloaded'
            })
        } catch (error) {
            this.ctx.logger.error('初始化模板文件时发生错误:', error)
        }

        this.ctx.setTimeout(
            async () => {
                try {
                    page.close()
                } catch (error) {
                    this.ctx.logger.error('关闭页面时发生错误:', error)
                }
            },
            3 * 60 * 1000
        )
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
            waitUntil: 'domcontentloaded'
        })

        this.ctx.logger.info('网页加载完成，开始等待字体加载。')

        // 等待字体加载完成
        await page.evaluate(() => document.fonts.ready)

        this.ctx.logger.info('字体加载完成。')

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

    public async renderUserPersona(
        data: UserPersonaProfile,
        username: string,
        avatar: string
    ): Promise<Buffer | string> {
        try {
            const page = await this._renderUserPersona(data, username, avatar)

            const element = await page.$('.container')
            if (!element) {
                await page.close()
                throw new Error('无法在渲染的 HTML 中找到 .container 元素。')
            }

            const imageBuffer = await element.screenshot()
            await page.close()

            this.ctx.logger.info('用户画像图片渲染成功！')
            return imageBuffer
        } catch (error) {
            this.ctx.logger.error('渲染用户画像图片时发生错误:', error)
            if (error instanceof Error) {
                return `图片渲染失败: ${error.message}`
            }
            return '图片渲染失败，发生未知错误。'
        }
    }

    private async _renderUserPersona(
        data: UserPersonaProfile,
        username: string,
        avatar: string
    ): Promise<Awaited<ReturnType<Context['puppeteer']['page']>>> {
        if (!this.ctx.puppeteer) {
            throw new Error('Puppeteer service is not available.')
        }

        const templatePath = path.resolve(
            this.templateDir,
            'template_user.html'
        )
        const randomId = Math.random().toString(36).substring(2, 15)
        const outTemplateHtmlPath = path.resolve(
            this.templateDir,
            `${randomId}.html`
        )

        const formatTags = (tags: string[] | undefined) => {
            if (!tags || tags.length === 0)
                return '<div class="empty-state">暂无数据</div>'
            return tags.map((tag) => `<div class="tag">${tag}</div>`).join('')
        }

        const formatList = (items: string[] | '无' | undefined) => {
            if (!items || items === '无' || items.length === 0)
                return '<li>暂无数据</li>'
            return (items as string[])
                .map((item) => `<li>${item}</li>`)
                .join('')
        }

        const formatEvidence = (
            items: UserPersonaProfile['evidence']
        ): string => {
            if (!items || items.length === 0) {
                return '<li>暂无事实依据</li>'
            }

            return items
                .map((item) => {
                    const quoteHtml = (item || '')
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .join('<br/>')
                    return `
                        <li>
                            <div class="evidence-quote">${quoteHtml}</div>
                        </li>
                    `
                })
                .join('')
        }

        const templateHtml = await fs.readFile(templatePath, 'utf-8')
        const filledHtml = renderTemplate(templateHtml, {
            avatar:
                avatar ||
                'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp',
            username,
            analysisDate: new Date().toLocaleString(),
            summary: data.summary || '暂无摘要',
            keyTraits: formatTags(data.keyTraits),
            interests: formatTags(data.interests),
            communicationStyle: data.communicationStyle || '暂无记录',
            evidence: formatEvidence(data.evidence)
        })

        await fs.writeFile(outTemplateHtmlPath, filledHtml)

        this.ctx.logger.info(
            '用户画像 HTML 模板填充完成，正在调用 Puppeteer 进行渲染...'
        )

        const page = await this.ctx.puppeteer.page()

        // 重新加载页面并使用 goto 访问本地文件
        await page.goto('file://' + outTemplateHtmlPath, {
            waitUntil: 'domcontentloaded'
        })

        this.ctx.logger.info('网页加载完成，开始等待字体加载。')

        // 等待字体加载完成
        await page.evaluate(() => document.fonts.ready)

        this.ctx.logger.info('字体加载完成。')

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
        )

        return page
    }
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_renderer: RendererService
    }
}
