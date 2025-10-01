# 字体下载工具

这个 TypeScript 脚本用于下载远程字体文件到本地，支持递归处理多级 CSS 引用和并行下载。

## 功能特性

- ✅ **TypeScript 实现**：完整的类型安全
- ⚡ **并行下载**：支持最多 5 个并发下载，大幅提升速度
- 🔄 **递归处理**：自动处理 `@import` 引用的多级 CSS 文件
- 📦 **路径本地化**：自动将所有远程路径替换为本地相对路径
- 🛡️ **防重复下载**：智能去重，避免重复处理同一文件

## 使用方法

### 1. 安装依赖

```bash
yarn install
# 或
npm install
```

### 2. 运行脚本

```bash
yarn download-fonts
# 或
npm run download-fonts
```

### 3. 使用下载的字体

在你的 CSS 文件中引入：

```css
@import url('./fonts-local.css');
```

## 工作原理

1. **下载入口 CSS**：下载配置的 3 个字体包的主 CSS 文件
2. **递归处理引用**：
   - 提取 `@import` 语句
   - 递归下载被引用的 CSS 文件
   - 替换为本地路径
3. **并行下载字体**：
   - 提取所有 `url()` 中的字体文件
   - 使用并发控制并行下载（最多 5 个同时）
   - 替换为本地相对路径
4. **生成本地化文件**：
   - 保存原始 CSS 文件
   - 生成路径本地化的 `-local.css` 文件
   - 创建统一的 `fonts-local.css` 引入文件

## 目录结构

```
resources/css/
├── fonts-local.css                          # 统一引入文件
└── fonts/
    ├── maple-mono@5.2.5/
    │   ├── index.css                        # 原始 CSS
    │   ├── index-local.css                  # 本地化 CSS
    │   └── *.woff2                          # 字体文件
    ├── noto-color-emoji@5.0.25/
    │   ├── index.css
    │   ├── index-local.css
    │   └── *.woff2
    └── lxgw-wenkai-screen-webfont@1.6.0/
        ├── style.css                        # 原始主 CSS
        ├── style-local.css                  # 本地化主 CSS
        ├── lxgwwenkaiscreen.css            # 被引用的 CSS
        ├── lxgwwenkaiscreen-local.css      # 本地化引用 CSS
        └── *.woff2                          # 字体文件
```

## 配置

修改 `scripts/download-fonts.ts` 中的常量：

```typescript
const FONT_URLS = [
    'https://font.onmicrosoft.cn/@fontsource/maple-mono@5.2.5/index.css',
    'https://font.onmicrosoft.cn/@fontsource/noto-color-emoji@5.0.25/index.css',
    'https://font.onmicrosoft.cn/lxgw-wenkai-screen-webfont@1.6.0/style.css'
]

const MAX_CONCURRENT = 5 // 最大并发下载数
```

## 技术细节

- **URL 解析**：使用 `new URL(relativeUrl, baseUrl)` 正确处理相对路径
- **并发控制**：实现了通用的 `parallelDownload` 函数，控制最大并发数
- **正则替换**：安全转义特殊字符，确保正确替换路径
- **错误处理**：单个文件失败不影响整体流程，继续处理其他文件

## 示例输出

```
🚀 开始下载字体...

📁 输出目录: G:\...\resources\css\fonts

⚡ 开始并行处理 3 个字体包...

📦 处理字体: maple-mono@5.2.5
───────────────────────────────────────
📥 下载: https://font.onmicrosoft.cn/@fontsource/maple-mono@5.2.5/index.css
✅ 已保存原始 CSS: maple-mono@5.2.5/index.css
🔍 找到 8 个字体引用，开始并行下载...
   ✓ maple-mono-latin-400-normal.woff2 (24.56 KB)
   ✓ maple-mono-latin-600-normal.woff2 (24.89 KB)
   ...
✅ 已生成本地化 CSS: maple-mono@5.2.5/index-local.css

═══════════════════════════════════════
✨ 下载完成！
═══════════════════════════════════════
📄 主引入文件: resources/css/fonts-local.css
📊 处理结果:
   • maple-mono@5.2.5: 8 个字体文件
   • noto-color-emoji@5.0.25: 2 个字体文件
   • lxgw-wenkai-screen-webfont@1.6.0: 4 个字体文件

💡 使用方法:
   在 CSS 文件中添加:
   @import url('./fonts-local.css');
```
