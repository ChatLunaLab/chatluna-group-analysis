import { Context, Service } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { GroupAnalysisResult, UserPersonaProfile } from '../types'
import { Config } from '../config'
import { fileURLToPath } from 'url'
import {
    formatGoldenQuotes,
    formatTopics,
    formatUserStats,
    formatUserTitles,
    generateActiveHoursChart,
    renderTemplate
} from '../utils'
import { skinRegistry } from '../skins'

export class RendererService extends Service {
    static inject = ['puppeteer']

    templateDir: string

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_renderer', true)

        this.templateDir = path.resolve(
            ctx.baseDir,
            'data/chatluna/group_analysis'
        )

        this.ctx.on('ready', async () => {
            await this.init()
        })
    }

    private getSkinPath(filename: string): string {
        const skin = this.config.skin || 'md3'
        return path.resolve(this.templateDir, skin, filename)
    }

    private async imageToBase64(url: string): Promise<string> {
        try {
            this.ctx.logger.debug(`转换图片为 Base64: ${url}`)
            const response = await fetch(url)
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`)
            }

            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            // 根据 URL 或 Content-Type 推断 MIME 类型
            const contentType =
                response.headers.get('content-type') || 'image/png'
            const base64 = buffer.toString('base64')
            const dataUrl = `data:${contentType};base64,${base64}`

            this.ctx.logger.debug(
                `图片已转换为 Base64，大小: ${base64.length} 字符`
            )
            return dataUrl
        } catch (error) {
            this.ctx.logger.warn(`图片转换 Base64 失败: ${url}`, error)
            // 返回一个 1x1 透明 PNG 的 Base64
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
    }

    async init() {
        const dirname =
            __dirname?.length > 0 ? __dirname : fileURLToPath(import.meta.url)
        const resourcesDir = dirname + '/../resources'

        const templateDir = this.templateDir
        const skin = this.config.skin || 'md3'

        // Source: resources/md3 (or other skin)
        const skinSourceDir = path.resolve(resourcesDir, skin)
        // Destination: data/chatluna/group_analysis/md3
        const skinDestDir = path.resolve(templateDir, skin)

        /* try {
            await fs.access(skinDestDir)
        } catch (error) { */
        await fs.mkdir(skinDestDir, { recursive: true })

        // Copy only the configured skin directory
        await fs.cp(skinSourceDir, skinDestDir, { recursive: true })
        /*   } */

        const tempHtmlFiles = await fs
            .readdir(skinDestDir)
            .then((files) =>
                files.filter(
                    (file) =>
                        file.endsWith('.html') && !file.startsWith('template')
                )
            )
            .catch(() => [])

        for (const file of tempHtmlFiles) {
            await fs.unlink(path.resolve(skinDestDir, file))
        }

        const page = await this.ctx.puppeteer.page()

        try {
            await page.goto(
                'file://' + this.getSkinPath('template_user.html'),
                {
                    waitUntil: 'domcontentloaded'
                }
            )
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
        let theme = this.config.theme
        if (theme === 'auto') {
            const hour = new Date().getHours()
            theme = hour >= 19 || hour < 6 ? 'dark' : 'light'
        }

        const page = await this._renderGroupAnalysis(data, theme)

        const pdfBuffer = await page.pdf({ format: 'A4' })
        await page.close()

        return pdfBuffer
    }

    public async renderGroupAnalysis(
        data: GroupAnalysisResult,
        config: Config
    ): Promise<Buffer | string> {
        try {
            let theme = config.theme
            if (theme === 'auto') {
                const hour = new Date().getHours()
                theme = hour >= 19 || hour < 6 ? 'dark' : 'light'
            }

            const page = await this._renderGroupAnalysis(data, theme)

            // 找到页面中的 container 元素
            const renderer = skinRegistry.getSafe(config.skin || 'md3')
            const selector = renderer.containerSelector
            const element = await page.$(selector)
            if (!element) {
                await page.close()
                throw new Error(`无法在渲染的 HTML 中找到 ${selector} 元素。`)
            }

            const imageBuffer = await element.screenshot({})
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
        data: GroupAnalysisResult,
        theme: 'light' | 'dark'
    ): Promise<Awaited<ReturnType<Context['puppeteer']['page']>>> {
        // 检查 puppeteer 是否可用
        if (!this.ctx.puppeteer) {
            throw new Error('Puppeteer service is not available.')
        }

        const templatePath = this.getSkinPath('template_group.html')
        const randomId = Math.random().toString(36).substring(2, 15)
        const skin = this.config.skin || 'md3'
        const outTemplateHtmlPath = path.resolve(
            this.templateDir,
            skin,
            `${randomId}.html`
        )

        const dynamicAvatarUrl =
            data.userStats?.[Math.floor(Math.random() * data.userStats.length)]
                ?.avatar ||
            'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp'

        // 将头像转换为 Base64
        const dynamicAvatarBase64 = await this.imageToBase64(dynamicAvatarUrl)

        // 读取模板文件并替换占位符
        const templateHtml = await fs.readFile(templatePath, 'utf-8')
        const filledHtml = renderTemplate(templateHtml, {
            groupName: data.groupName,
            analysisDate: data.analysisDate,
            totalMessages: data.totalMessages.toString(),
            totalParticipants: data.totalParticipants.toString(),
            totalChars: data.totalChars.toString(),
            mostActivePeriod: data.mostActivePeriod,
            emojiCount: (data.emojiCount || 0).toString(),
            userStats: formatUserStats(data.userStats, skin),
            topics: formatTopics(data.topics || [], skin),
            userTitles: formatUserTitles(data.userTitles || [], skin),
            activeHoursChart: generateActiveHoursChart(
                data.activeHoursData || {},
                skin
            ),
            goldenQuotes: formatGoldenQuotes(data.goldenQuotes || [], skin),
            theme,
            dynamicAvatarUrl: dynamicAvatarBase64
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
        avatar: string,
        config: Config
    ): Promise<Buffer | string> {
        try {
            let theme = config.theme
            if (theme === 'auto') {
                const hour = new Date().getHours()
                theme = hour >= 19 || hour < 6 ? 'dark' : 'light'
            }

            const page = await this._renderUserPersona(
                data,
                username,
                avatar,
                theme
            )

            const renderer = skinRegistry.getSafe(config.skin || 'md3')
            const selector = renderer.containerSelector
            const element = await page.$(selector)
            if (!element) {
                await page.close()
                throw new Error(`无法在渲染的 HTML 中找到 ${selector} 元素。`)
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
        avatar: string,
        theme: 'light' | 'dark'
    ): Promise<Awaited<ReturnType<Context['puppeteer']['page']>>> {
        if (!this.ctx.puppeteer) {
            throw new Error('Puppeteer service is not available.')
        }

        const templatePath = this.getSkinPath('template_user.html')
        const randomId = Math.random().toString(36).substring(2, 15)
        const skin = this.config.skin || 'md3'
        const outTemplateHtmlPath = path.resolve(
            this.templateDir,
            skin,
            `${randomId}.html`
        )

        const renderer = skinRegistry.getSafe(skin)

        const formatTags = (tags: string[] | undefined) => {
            if (renderer.formatTags) {
                return renderer.formatTags(tags)
            }
            // Fallback if skin doesn't implement formatTags
            if (!tags || tags.length === 0) {
                return '<div class="empty-state">暂无数据</div>'
            }
            return tags.map((tag) => `<div class="chip">${tag}</div>`).join('')
        }

        const formatEvidence = (
            items: UserPersonaProfile['evidence']
        ): string => {
            if (renderer.formatEvidence) {
                return renderer.formatEvidence(items)
            }
            // Fallback if skin doesn't implement formatEvidence
            if (!items || items.length === 0) {
                return '<div class="empty-state">暂无事实依据</div>'
            }

            const cards = items
                .map((item) => {
                    const quoteHtml = (item || '')
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .join('<br/>')
                    return `
                        <div class="card outlined-card evidence-card">
                            <p>${quoteHtml}</p>
                        </div>
                    `
                })
                .join('')

            return `<div class="card-grid">${cards}</div>`
        }

        const dynamicAvatarUrl =
            avatar ||
            'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp'

        // 将头像转换为 Base64
        const dynamicAvatarBase64 = await this.imageToBase64(dynamicAvatarUrl)

        const templateHtml = await fs.readFile(templatePath, 'utf-8')
        const filledHtml = renderTemplate(templateHtml, {
            avatar: dynamicAvatarBase64,
            username,
            analysisDate: data.analysisDate || '暂无记录',
            summary: data.summary || '暂无摘要',
            keyTraits: formatTags(data.keyTraits),
            interests: formatTags(data.interests),
            communicationStyle: data.communicationStyle || '暂无记录',
            evidence: formatEvidence(data.evidence),
            theme,
            dynamicAvatarUrl: dynamicAvatarBase64
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
