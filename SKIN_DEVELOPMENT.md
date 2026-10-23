# 皮肤开发指南 / Skin Development Guide

本指南将帮助您为 `koishi-plugin-chatluna-group-analysis` 创建自定义皮肤主题。

---

## 📚 目录

- [快速开始](#快速开始)
- [皮肤架构](#皮肤架构)
- [创建自定义皮肤](#创建自定义皮肤)
- [皮肤渲染器接口](#皮肤渲染器接口)
- [资源文件结构](#资源文件结构)
- [实现示例](#实现示例)
- [测试皮肤](#测试皮肤)
- [提交贡献](#提交贡献)

---

## 快速开始

插件目前自带两个皮肤：

1. **md3** - Material Design 3 风格（默认）
2. **anime** - 二次元奶油手账风格

您可以参考这两个皮肤来创建自己的皮肤主题。

---

## 皮肤架构

皮肤系统采用插件式架构，每个皮肤都是一个实现了 `SkinRenderer` 接口的类。

### 核心组件

```
src/skins/
├── index.ts          # 皮肤注册中心
├── types.ts          # 类型定义和接口
├── md3.ts            # Material Design 3 皮肤
└── anime.ts          # 二次元皮肤

resources/
├── md3/              # MD3 皮肤资源
│   ├── template_group.html
│   ├── template_user.html
│   └── css/
└── anime/            # Anime 皮肤资源
    ├── template_group.html
    ├── template_user.html
    ├── css/
    └── images/
```

---

## 创建自定义皮肤

### 第 1 步：创建皮肤渲染器类

在 `src/skins/` 目录下创建新的 TypeScript 文件，例如 `my-skin.ts`：

```typescript
import { SkinRenderer, getAvatarUrl } from './types'
import { GroupAnalysisResult, UserStats } from '../types'

export class MySkinRenderer implements SkinRenderer {
    readonly id = 'my-skin'
    readonly name = '我的皮肤'
    readonly containerSelector = '.my-container'

    formatUserStats(userStats: UserStats[]): string {
        if (!userStats || userStats.length === 0) {
            return '<div class="empty-state">暂无用户统计信息</div>'
        }

        return userStats
            .map(user => `
                <div class="user-card">
                    <img src="${getAvatarUrl(user.userId)}" alt="${user.nickname}">
                    <h3>${user.nickname}</h3>
                    <p>发言数: ${user.messageCount}</p>
                    <p>字数: ${user.charCount}</p>
                </div>
            `)
            .join('')
    }

    formatGoldenQuotes(quotes: GroupAnalysisResult['goldenQuotes']): string {
        // 实现金句渲染逻辑
        // ...
    }

    formatUserTitles(userTitles: GroupAnalysisResult['userTitles']): string {
        // 实现称号渲染逻辑
        // ...
    }

    formatTopics(topics: GroupAnalysisResult['topics']): string {
        // 实现话题渲染逻辑
        // ...
    }

    generateActiveHoursChart(activeHours: Record<number, number>): string {
        // 实现活跃时段图表渲染逻辑
        // ...
    }

    // 可选方法
    formatTags?(tags: string[] | undefined): string {
        // 用于用户画像的标签渲染
    }

    formatEvidence?(evidence: string[] | '无' | undefined): string {
        // 用于用户画像的证据渲染
    }
}
```

### 第 2 步：注册皮肤

在 `src/skins/index.ts` 中导入并注册您的皮肤：

```typescript
import { MySkinRenderer } from './my-skin'

class SkinRegistry {
    constructor() {
        // 注册内置皮肤
        this.register(new Md3SkinRenderer())
        this.register(new AnimeSkinRenderer())
        this.register(new MySkinRenderer())  // 添加您的皮肤
    }
    // ...
}
```

并导出您的皮肤类：

```typescript
export { MySkinRenderer } from './my-skin'
```

### 第 3 步：创建资源文件

在 `resources/` 目录下创建以皮肤 ID 命名的文件夹（例如 `my-skin/`）：

```
resources/my-skin/
├── template_group.html      # 群聊分析模板
├── template_user.html       # 用户画像模板
├── css/
│   ├── template_group.css   # 群聊分析样式
│   └── template_user.css    # 用户画像样式（可选）
└── images/                  # 图片资源（可选）
    ├── bg_light.jpg
    └── bg_dark.jpg
```

### 第 4 步：添加配置选项

在 `src/config.ts` 中添加您的皮肤到配置选项：

```typescript
skin: Schema.union([
    Schema.const('md3').description('Material Design 3'),
    Schema.const('anime').description('二次元风格'),
    Schema.const('my-skin').description('我的皮肤')  // 添加您的皮肤
])
    .description('渲染界面皮肤。')
    .default('md3'),
```

---

## 皮肤渲染器接口

### 必须实现的属性

```typescript
interface SkinRenderer {
    // 皮肤唯一标识符（用于配置和资源路径）
    readonly id: string

    // 皮肤显示名称
    readonly name: string

    // Puppeteer 截图时使用的 CSS 选择器
    // 用于定位要截图的主容器元素
    readonly containerSelector: string
}
```

### 必须实现的方法

#### 1. `formatUserStats(userStats: UserStats[]): string`

渲染用户统计列表（龙王榜）。

**参数：**
- `userStats`: 用户统计数据数组

**返回：** HTML 字符串

**示例数据：**
```typescript
{
    userId: "12345",
    nickname: "张三",
    messageCount: 150,
    charCount: 3500,
    replyRatio: 0.45,    // 回复率 (0-1)
    nightRatio: 0.20,    // 夜间活跃度 (0-1)
    // ... 更多字段
}
```

#### 2. `formatGoldenQuotes(quotes: Array): string`

渲染金句/逆天发言列表。

**参数：**
```typescript
{
    content: "发言内容",
    sender: "发言者昵称",
    reason: "入选理由"
}
```

#### 3. `formatUserTitles(userTitles: Array): string`

渲染用户称号列表。

**参数：**
```typescript
{
    id: "12345",          // 用户 ID
    name: "张三",         // 用户昵称
    title: "话题之王",    // 称号
    mbti: "ENFP",         // MBTI 类型（可选）
    reason: "获得原因"
}
```

#### 4. `formatTopics(topics: Array): string`

渲染讨论话题列表。

**参数：**
```typescript
{
    topic: "话题标题",
    detail: "话题详情描述",
    contributors: ["张三", "李四", "王五"]  // 参与者列表
}
```

#### 5. `generateActiveHoursChart(activeHours: Record<number, number>): string`

生成 24 小时活跃度图表。

**参数：**
- `activeHours`: 键为小时数 (0-23)，值为消息数量的对象

**示例：**
```typescript
{
    0: 5,    // 凌晨 0 点有 5 条消息
    1: 2,
    // ...
    23: 10
}
```

### 可选方法（用于用户画像）

#### 6. `formatTags?(tags: string[]): string`

渲染标签列表（用于用户画像的兴趣、特征等）。

#### 7. `formatEvidence?(evidence: string[]): string`

渲染证据列表（用于用户画像的事实依据）。

---

## 资源文件结构

### HTML 模板

HTML 模板使用简单的变量替换语法：`${variableName}`

#### `template_group.html` 可用变量

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="./css/template_group.css">
</head>
<body class="${theme}-theme">
    <div class="my-container">
        <h1>${groupName}</h1>
        <p>${analysisDate}</p>

        <div class="stats">
            <span>总消息: ${totalMessages}</span>
            <span>参与人数: ${totalParticipants}</span>
            <span>总字数: ${totalChars}</span>
            <span>活跃时段: ${mostActivePeriod}</span>
        </div>

        <section>
            <h2>龙王榜</h2>
            ${userStats}
        </section>

        <section>
            <h2>群友称号</h2>
            ${userTitles}
        </section>

        <section>
            <h2>热门话题</h2>
            ${topics}
        </section>

        <section>
            <h2>群圣经</h2>
            ${goldenQuotes}
        </section>

        <section>
            <h2>活跃分布</h2>
            ${activeHoursChart}
        </section>
    </div>
</body>
</html>
```

**变量说明：**
- `${theme}`: `'light'` 或 `'dark'`（用于切换主题样式）
- `${groupName}`: 群组名称
- `${analysisDate}`: 分析日期
- `${totalMessages}`: 总消息数
- `${totalParticipants}`: 参与人数
- `${totalChars}`: 总字数
- `${mostActivePeriod}`: 最活跃时段
- `${userStats}`: 用户统计 HTML（由 `formatUserStats` 生成）
- `${userTitles}`: 用户称号 HTML（由 `formatUserTitles` 生成）
- `${topics}`: 话题 HTML（由 `formatTopics` 生成）
- `${goldenQuotes}`: 金句 HTML（由 `formatGoldenQuotes` 生成）
- `${activeHoursChart}`: 活跃度图表 HTML（由 `generateActiveHoursChart` 生成）
- `${dynamicAvatarUrl}`: 随机用户头像（Base64 格式）

#### `template_user.html` 可用变量

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="./css/template_user.css">
</head>
<body class="${theme}-theme">
    <div class="my-container">
        <img src="${avatar}" alt="${username}">
        <h1>${username}</h1>
        <p>分析日期: ${analysisDate}</p>

        <section>
            <h2>个性摘要</h2>
            <p>${summary}</p>
        </section>

        <section>
            <h2>关键特征</h2>
            ${keyTraits}
        </section>

        <section>
            <h2>兴趣爱好</h2>
            ${interests}
        </section>

        <section>
            <h2>沟通风格</h2>
            <p>${communicationStyle}</p>
        </section>

        <section>
            <h2>事实依据</h2>
            ${evidence}
        </section>
    </div>
</body>
</html>
```

### CSS 样式

为不同主题（亮色/暗色）提供样式：

```css
/* 亮色主题 */
body, body.light-theme {
    --bg-color: #ffffff;
    --text-color: #000000;
    /* ... */
}

/* 暗色主题 */
body.dark-theme {
    --bg-color: #1a1a1a;
    --text-color: #ffffff;
    /* ... */
}

.my-container {
    /* 您的容器样式 */
    /* 这个类名应该与 containerSelector 匹配 */
}
```

---

## 实现示例

### 示例 1：简约卡片风格

参考 `src/skins/md3.ts` 的实现，使用简洁的卡片布局。

### 示例 2：游戏风格界面

参考 `src/skins/anime.ts` 的实现，使用对话框和角色卡片。

### 获取用户头像

使用提供的工具函数：

```typescript
import { getAvatarUrl } from './types'

const avatarUrl = getAvatarUrl(userId)  // 返回 QQ 头像 URL
```

### 处理空数据

始终检查并处理空数据情况：

```typescript
formatUserStats(userStats: UserStats[]): string {
    if (!userStats || userStats.length === 0) {
        return '<div class="empty-state">暂无数据</div>'
    }
    // ... 渲染逻辑
}
```

---

## 测试皮肤

### 1. 构建插件

```bash
npm run build
```

### 2. 在 Koishi 中启用插件

在 Koishi 配置中选择您的皮肤：

```yaml
plugins:
  chatluna-group-analysis:
    skin: my-skin
    theme: auto
```

### 3. 生成测试报告

运行群聊分析命令测试您的皮肤渲染效果。

### 4. 调试技巧

- 检查生成的 HTML 文件（位于 `data/chatluna/group_analysis/my-skin/` 目录）
- 使用浏览器开发者工具检查 CSS 样式
- 查看插件日志中的错误信息

---

## 提交贡献

如果您创建了一个优秀的皮肤主题，欢迎提交 Pull Request 分享给社区！

### PR 检查清单

- [ ] 在 `src/skins/` 中实现了完整的 `SkinRenderer` 接口
- [ ] 在 `src/skins/index.ts` 中注册了皮肤
- [ ] 在 `resources/` 中提供了所有必需的资源文件
- [ ] 在 `src/config.ts` 中添加了配置选项
- [ ] 支持亮色和暗色两种主题
- [ ] 处理了所有空数据情况
- [ ] 测试了群聊分析和用户画像两种报告
- [ ] 代码符合项目的 ESLint 规范
- [ ] 在 README.md 中添加了皮肤预览截图（可选）

### 提交步骤

1. Fork 本项目
2. 创建您的特性分支：`git checkout -b feature/my-awesome-skin`
3. 提交您的更改：`git commit -m 'feat(skins): add my-awesome-skin theme'`
4. 推送到分支：`git push origin feature/my-awesome-skin`
5. 创建 Pull Request

### PR 描述模板

```markdown
## 皮肤名称

[您的皮肤名称]

## 设计灵感

[简要描述皮肤的设计理念和风格]

## 预览截图

[添加亮色和暗色主题的截图]

## 测试情况

- [x] 群聊分析报告渲染正常
- [x] 用户画像报告渲染正常
- [x] 亮色主题正常
- [x] 暗色主题正常
- [x] 处理了空数据情况

## 其他说明

[任何额外的说明或注意事项]
```

---

## 常见问题

### Q: 如何调整图表高度？

A: 在 `generateActiveHoursChart` 方法中调整 `maxBarHeight` 变量，并确保 CSS 中的容器高度与之匹配。

### Q: 可以使用外部字体吗？

A: 可以！在 CSS 中使用 `@import` 引入 Google Fonts 或其他字体资源。

### Q: 如何支持更多的自定义选项？

A: 您可以在皮肤类中添加配置属性，并在构造函数中接收配置参数。

### Q: 可以使用图片背景吗？

A: 可以！将图片放在 `resources/your-skin/images/` 目录中，并在 CSS 中引用（使用相对路径）。

---

## 相关资源

- [项目 GitHub 仓库](https://github.com/ChatLunaLab/chatluna-group-analysis)
- [Koishi 插件开发文档](https://koishi.chat/)
- [TypeScript 官方文档](https://www.typescriptlang.org/)

---

## 许可证

本项目采用 MIT 许可证。您的皮肤贡献也将遵循相同的许可证。

---

**祝您开发愉快！如有任何问题，欢迎在 GitHub Issues 中提问。**
