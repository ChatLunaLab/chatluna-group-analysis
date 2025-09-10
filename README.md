# koishi-plugin-group-analysis

[![koishi](https://img.shields.io/badge/Koishi-Plugin-red?style=flat-square)](https://koishi.chat)

> **警告：本插件目前处于早期测试阶段，功能可能不稳定，请勿在生产环境中使用或下载！**

一个为 Koishi 设计的群聊分析插件，灵感来源于 `astrbot-qq-group-daily-analysis`。

## ✨ 功能

*   **多维度统计**: 分析群聊的总消息数、参与人数、总字数、最活跃时段、发言排行榜等。
*   **智能话题总结**: 集成大语言模型（LLM），自动从聊天记录中总结出核心讨论话题。
*   **图片报告**: 将分析结果渲染成美观的图片报告，直观易读。
*   **灵活触发**: 支持通过“群分析”命令手动触发，也支持通过 CRON 表达式定时自动发送。
*   **高度可配置**:
    *   支持自定义 LLM API（默认使用 Gemini）。
    *   支持配置群组白名单，精确控制插件生效范围。
    *   支持自定义定时任务。

## ⚙️ 配置

所有配置项均可在 Koishi 控制台的插件配置页面进行设置。

*   **基础设置**:
    *   `allowedGroups`: 允许使用此插件的群号列表。
    *   `cronSchedule`: 定时发送报告的 CRON 表达式。
    *   `cronAnalysisDays`: 定时任务分析的天数。
*   **LLM 设置**:
    *   `llmApiEndpoint`: LLM 的 API 接入点。
    *   `llmApiKey`: 您的 API Key。
    *   `llmModel`: 使用的模型名称。
*   **高级设置**:
    *   `promptTopic`: 用于话题总结的 Prompt 模板。

## 📝 命令

*   `群分析 [days:number]`: 分析指定天数内的群聊活动。例如，`群分析 3` 会分析最近 3 天的聊天记录。

## 依赖

*   `koishi-plugin-puppeteer`: 用于将报告渲染成图片。
*   `koishi-plugin-schedule`: （可选）如果需要使用定时发送功能，则需要安装此插件。
