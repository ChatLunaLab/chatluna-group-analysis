import { Context, Service } from 'koishi'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Config } from '../config'
import { GroupAnalysisResult, UserPersonaProfile } from '../types'
import { skinRegistry } from '../skins'

type Page = Awaited<ReturnType<Context['puppeteer']['page']>>

const FALLBACK_AVATAR =
    'https://cravatar.cn/avatar/00000000000000000000000000000000?d=mp'

export class RendererService extends Service {
    static inject = ['puppeteer']

    private templateDir: string

    constructor(
        ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chatluna_group_analysis_renderer', true)
        this.templateDir = path.resolve(
            ctx.baseDir,
            'data/chatluna/group_analysis'
        )
        ctx.on('ready', () => this.init())
    }

    async renderGroupAnalysisToPdf(data: GroupAnalysisResult): Promise<Buffer> {
        const skin = this.config.skin || 'md3'
        const values = await this.createGroupValues(
            data,
            this.getTheme(this.config.theme),
            skin
        )
        return this.renderPage(skin, 'template_group.html', values, (page) =>
            page.pdf({ format: 'A4' })
        )
    }

    async renderGroupAnalysis(
        data: GroupAnalysisResult,
        config: Config
    ): Promise<Buffer | string> {
        try {
            const skin = config.skin || 'md3'
            const values = await this.createGroupValues(
                data,
                this.getTheme(config.theme),
                skin
            )
            return await this.renderPage(
                skin,
                'template_group.html',
                values,
                async (page) => {
                    const selector =
                        skinRegistry.getSafe(skin).containerSelector
                    const element = await page.$(selector)
                    if (!element)
                        throw new Error(
                            `无法在渲染的 HTML 中找到 ${selector} 元素。`
                        )
                    return element.screenshot({})
                }
            )
        } catch (error) {
            this.ctx.logger.error('渲染报告图片时发生错误:', error)
            return error instanceof Error
                ? `图片渲染失败: ${error.message}`
                : '图片渲染失败，发生未知错误。'
        }
    }

    async renderUserPersona(
        data: UserPersonaProfile,
        username: string,
        avatar: string,
        config: Config
    ): Promise<Buffer | string> {
        try {
            const skin = config.skin || 'md3'
            const renderer = skinRegistry.getSafe(skin)
            const values = {
                avatar: await this.imageToBase64(avatar || FALLBACK_AVATAR),
                username,
                analysisDate: data.analysisDate || '暂无记录',
                summary: data.summary || '暂无摘要',
                keyTraits: renderer.formatTags(data.keyTraits),
                interests: renderer.formatTags(data.interests),
                communicationStyle: data.communicationStyle || '暂无记录',
                evidence: renderer.formatEvidence(data.evidence),
                theme: this.getTheme(config.theme)
            }
            return await this.renderPage(
                skin,
                'template_user.html',
                values,
                async (page) => {
                    const element = await page.$(renderer.containerSelector)
                    if (!element)
                        throw new Error(
                            `无法在渲染的 HTML 中找到 ${renderer.containerSelector} 元素。`
                        )
                    return element.screenshot()
                }
            )
        } catch (error) {
            this.ctx.logger.error('渲染用户画像图片时发生错误:', error)
            return error instanceof Error
                ? `图片渲染失败: ${error.message}`
                : '图片渲染失败，发生未知错误。'
        }
    }

    private async init() {
        const dirname =
            typeof __dirname === 'string'
                ? __dirname
                : path.dirname(fileURLToPath(import.meta.url))
        const skin = this.config.skin || 'md3'
        const source = path.resolve(dirname, '../resources', skin)
        const destination = path.resolve(this.templateDir, skin)

        await fs.mkdir(destination, { recursive: true })
        await fs.cp(source, destination, { recursive: true })

        const files = await fs.readdir(destination).catch(() => [])
        await Promise.all(
            files
                .filter(
                    (file) =>
                        file.endsWith('.html') && !file.startsWith('template')
                )
                .map((file) => fs.unlink(path.resolve(destination, file)))
        )
    }

    private async createGroupValues(
        data: GroupAnalysisResult,
        theme: string,
        skin: string
    ) {
        const renderer = skinRegistry.getSafe(skin)
        const users = data.userStats
        const randomUser = users.length
            ? users[Math.floor(Math.random() * users.length)]
            : undefined
        const avatar =
            randomUser && randomUser.avatar
                ? randomUser.avatar
                : FALLBACK_AVATAR

        return {
            groupName: data.groupName,
            analysisDate: data.analysisDate,
            totalMessages: String(data.totalMessages),
            totalParticipants: String(data.totalParticipants),
            totalChars: String(data.totalChars),
            mostActivePeriod: data.mostActivePeriod,
            emojiCount: String(data.emojiCount || 0),
            userStats: renderer.formatUserStats(users),
            topics: renderer.formatTopics(data.topics || []),
            userTitles: renderer.formatUserTitles(data.userTitles || []),
            activeHoursChart: renderer.generateActiveHoursChart(
                data.activeHoursData || {}
            ),
            goldenQuotes: renderer.formatGoldenQuotes(data.goldenQuotes || []),
            theme,
            dynamicAvatarUrl: await this.imageToBase64(avatar)
        }
    }

    private async renderPage<T>(
        skin: string,
        templateName: string,
        values: Record<string, string>,
        action: (page: Page) => Promise<T>
    ): Promise<T> {
        const directory = path.resolve(this.templateDir, skin)
        const template = await fs.readFile(
            path.resolve(directory, templateName),
            'utf-8'
        )
        const output = path.resolve(
            directory,
            `${Math.random().toString(36).slice(2, 15)}.html`
        )
        await fs.writeFile(output, renderTemplate(template, values))

        let page: Page | undefined
        try {
            page = await this.ctx.puppeteer.page()
            await page.goto(`file://${output}`, {
                waitUntil: 'domcontentloaded'
            })
            await page.evaluate(() => document.fonts.ready)
            return await action(page)
        } finally {
            await Promise.allSettled([
                page ? page.close() : Promise.resolve(),
                fs.unlink(output)
            ])
        }
    }

    private getTheme(theme: Config['theme']) {
        if (theme !== 'auto') return theme
        const hour = new Date().getHours()
        return hour >= 19 || hour < 6 ? 'dark' : 'light'
    }

    private async imageToBase64(url: string) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(10000)
            })
            if (!response.ok)
                throw new Error(`Failed to fetch image: ${response.statusText}`)
            const contentType =
                response.headers.get('content-type') || 'image/png'
            const base64 = Buffer.from(await response.arrayBuffer()).toString(
                'base64'
            )
            return `data:${contentType};base64,${base64}`
        } catch (error) {
            this.ctx.logger.warn(`图片转换 Base64 失败: ${url}`, error)
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
    }
}

function renderTemplate(template: string, data: Record<string, string>) {
    return template.replace(/\$\{(.*?)\}/g, (_, key) => data[key] || '')
}

declare module 'koishi' {
    interface Context {
        chatluna_group_analysis_renderer: RendererService
    }
}
