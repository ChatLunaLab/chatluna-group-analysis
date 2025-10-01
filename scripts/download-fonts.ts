import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FONT_URLS = [
    'https://font.onmicrosoft.cn/@fontsource/maple-mono@5.2.5/index.css',
    'https://font.onmicrosoft.cn/@fontsource/noto-color-emoji@5.0.25/index.css',
    'https://font.onmicrosoft.cn/lxgw-wenkai-screen-webfont@1.6.0/style.css'
]

const OUTPUT_DIR = join(__dirname, '..', 'resources', 'css', 'fonts')
const MAX_CONCURRENT = 10 // 最大并发下载数

interface DownloadedFont {
    originalUrl: string
    localPath: string
}

interface ProcessResult {
    cssContent: string
    localCssFileName: string
    downloadedFonts: DownloadedFont[]
}

interface FontResult {
    fontName: string
    localCssPath: string
    downloadedCount: number
}

async function downloadText(url: string): Promise<string> {
    console.log(`📥 下载: ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.text()
}

async function downloadBinary(url: string): Promise<Buffer> {
    console.log(`📦 下载字体: ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
}

function extractFontUrls(cssContent: string): string[] {
    const urls: string[] = []
    const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/g
    let match: RegExpExecArray | null

    while ((match = urlRegex.exec(cssContent)) !== null) {
        urls.push(match[1])
    }

    return urls
}

function extractImportUrls(cssContent: string): string[] {
    const urls: string[] = []
    // 匹配 @import url('...') 或 @import '...' 或 @import "..."
    const importRegex = /@import\s+(?:url\(['"]?([^'")\s]+)['"]?\)|['"]([^'"]+)['"])/g
    let match: RegExpExecArray | null

    while ((match = importRegex.exec(cssContent)) !== null) {
        const url = match[1] || match[2]
        if (url) urls.push(url)
    }

    return urls
}

function resolveUrl(baseUrl: string, relativeUrl: string): string | null {
    try {
        // 使用 URL API 自动处理相对路径
        return new URL(relativeUrl, baseUrl).href
    } catch (err) {
        console.warn(`⚠️  无法解析 URL: ${relativeUrl}`)
        return null
    }
}

function getFontName(url: string): string {
    // 从 URL 中提取字体名称
    // https://font.onmicrosoft.cn/@fontsource/maple-mono@5.2.5/index.css -> maple-mono@5.2.5
    // https://font.onmicrosoft.cn/lxgw-wenkai-screen-webfont@1.6.0/style.css -> lxgw-wenkai-screen-webfont@1.6.0
    const parts = url.split('/')
    const secondLastPart = parts[parts.length - 2] // 字体名称部分

    // 移除 @fontsource/ 前缀
    return secondLastPart.replace('@fontsource/', '')
}

async function downloadFontFile(
    absoluteUrl: string,
    fontDir: string
): Promise<{ fileName: string; size: number } | null> {
    try {
        const fontData = await downloadBinary(absoluteUrl)
        const fontFileName = absoluteUrl.split('/').pop()!.split('?')[0]
        const fontFilePath = join(fontDir, fontFileName)

        await writeFile(fontFilePath, fontData)
        const sizeKB = (fontData.length / 1024).toFixed(2)
        console.log(`   ✓ ${fontFileName} (${sizeKB} KB)`)

        return { fileName: fontFileName, size: fontData.length }
    } catch (err) {
        console.error(`   ✗ 下载失败: ${absoluteUrl} - ${(err as Error).message}`)
        return null
    }
}

async function parallelDownload<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    maxConcurrent: number = MAX_CONCURRENT
): Promise<R[]> {
    const results: R[] = []
    const executing: Promise<void>[] = []

    for (const item of items) {
        const promise = processor(item).then((result) => {
            results.push(result)
            executing.splice(executing.indexOf(promise), 1)
        })

        executing.push(promise)

        if (executing.length >= maxConcurrent) {
            await Promise.race(executing)
        }
    }

    await Promise.all(executing)
    return results
}

async function processCssFile(
    url: string,
    fontDir: string,
    fontName: string,
    processedCss: Set<string> = new Set()
): Promise<ProcessResult> {
    // 防止重复处理
    if (processedCss.has(url)) {
        console.log(`⏭️  跳过已处理的 CSS: ${url}`)
        return { cssContent: '', localCssFileName: '', downloadedFonts: [] }
    }
    processedCss.add(url)

    const cssContent = await downloadText(url)
    const cssFileName = url.split('/').pop()!.split('?')[0]

    // 保存原始 CSS
    await writeFile(join(fontDir, cssFileName), cssContent)
    console.log(`✅ 已保存原始 CSS: ${fontName}/${cssFileName}`)

    let localizedCss = cssContent
    const downloadedFonts: DownloadedFont[] = []

    // 1. 处理 @import 引用的 CSS 文件
    const importUrls = extractImportUrls(cssContent)
    if (importUrls.length > 0) {
        console.log(`📑 找到 ${importUrls.length} 个 CSS 引用`)

        for (const relativeUrl of importUrls) {
            const absoluteUrl = resolveUrl(url, relativeUrl)
            if (!absoluteUrl) continue

            try {
                const importedCssFileName = absoluteUrl.split('/').pop()!.split('?')[0]
                console.log(`   ↳ 处理引用: ${importedCssFileName}`)

                // 递归处理引用的 CSS
                const result = await processCssFile(absoluteUrl, fontDir, fontName, processedCss)
                downloadedFonts.push(...result.downloadedFonts)

                // 替换 @import 路径为本地路径
                localizedCss = localizedCss.replace(
                    new RegExp(relativeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    `./${importedCssFileName}`
                )
            } catch (err) {
                console.error(`   ✗ 处理 CSS 失败: ${absoluteUrl} - ${(err as Error).message}`)
            }
        }
    }

    // 2. 提取并并行下载字体文件
    const fontUrls = extractFontUrls(cssContent)
    if (fontUrls.length > 0) {
        console.log(`🔍 找到 ${fontUrls.length} 个字体引用，开始并行下载...`)

        const fontTasks = fontUrls
            .map((relativeUrl) => {
                const absoluteUrl = resolveUrl(url, relativeUrl)
                return absoluteUrl ? { relativeUrl, absoluteUrl } : null
            })
            .filter((task): task is { relativeUrl: string; absoluteUrl: string } => task !== null)

        const results = await parallelDownload(
            fontTasks,
            async ({ relativeUrl, absoluteUrl }) => {
                const result = await downloadFontFile(absoluteUrl, fontDir)
                return { relativeUrl, result }
            }
        )

        for (const { relativeUrl, result } of results) {
            if (result) {
                downloadedFonts.push({ originalUrl: relativeUrl, localPath: `./${result.fileName}` })

                // 替换字体文件路径
                localizedCss = localizedCss.replace(
                    new RegExp(relativeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    `./${result.fileName}`
                )
            }
        }
    }

    // 保存本地化的 CSS
    const localCssFileName = cssFileName.replace('.css', '-local.css')
    await writeFile(join(fontDir, localCssFileName), localizedCss)
    console.log(`✅ 已生成本地化 CSS: ${fontName}/${localCssFileName}`)

    return {
        cssContent: localizedCss,
        localCssFileName,
        downloadedFonts
    }
}

async function processFontCss(url: string): Promise<FontResult> {
    const fontName = getFontName(url)
    const fontDir = join(OUTPUT_DIR, fontName)
    await mkdir(fontDir, { recursive: true })

    console.log(`\n📦 处理字体: ${fontName}`)
    console.log(`───────────────────────────────────────`)

    const processedCss = new Set<string>()
    const result = await processCssFile(url, fontDir, fontName, processedCss)

    console.log()

    return {
        fontName,
        localCssPath: `./fonts/${fontName}/${result.localCssFileName}`,
        downloadedCount: result.downloadedFonts.length
    }
}

async function main() {
    try {
        console.log('🚀 开始下载字体...\n')

        // 创建输出目录
        await mkdir(OUTPUT_DIR, { recursive: true })
        console.log(`📁 输出目录: ${OUTPUT_DIR}\n`)

        const results: FontResult[] = []

        // 并行处理所有字体 CSS
        console.log(`⚡ 开始并行处理 ${FONT_URLS.length} 个字体包...`)
        const fontResults = await Promise.allSettled(
            FONT_URLS.map((url) => processFontCss(url))
        )

        for (const result of fontResults) {
            if (result.status === 'fulfilled') {
                results.push(result.value)
            } else {
                console.error(`❌ 处理失败: ${result.reason}`)
            }
        }

        // 生成统一的字体引入文件
        const importStatements = results
            .map((r) => `@import url('${r.localCssPath}');`)
            .join('\n')

        const mainCssPath = join(OUTPUT_DIR, '..', 'fonts-local.css')
        await writeFile(mainCssPath, importStatements)

        console.log('═══════════════════════════════════════')
        console.log('✨ 下载完成！')
        console.log('═══════════════════════════════════════')
        console.log(`📄 主引入文件: resources/css/fonts-local.css`)
        console.log(`📊 处理结果:`)
        results.forEach((r) => {
            console.log(`   • ${r.fontName}: ${r.downloadedCount} 个字体文件`)
        })
        console.log()
        console.log('💡 使用方法:')
        console.log('   在 CSS 文件中添加:')
        console.log("   @import url('./fonts-local.css');")
        console.log()
    } catch (error) {
        console.error('❌ 执行失败:', error)
        process.exit(1)
    }
}

main()
