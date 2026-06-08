<div align="center">

# koishi-plugin-chatluna-group-analysis

_Koishi 群聊分析插件_

## [![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna-group-analysis)](https://www.npmjs.com/package/koishi-plugin-chatluna-group-analysis) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna-group-analysis)](https://www.npmjs.com/package/koishi-plugin-chatluna-group-analysis) ![node version](https://img.shields.io/badge/node-%3E=18-green) ![github top language](https://img.shields.io/github/languages/top/ChatLunaLab/chatluna-group-analysis?logo=github)

</div>

> 此项目 fork 自 [lumia1998/koishi-plugin-group-analysis](https://github.com/lumia1998/koishi-plugin-group-analysis)，感谢原作者的贡献。
> 自 1.2.0 起，群分析插件支持设置皮肤，并默认内置两种皮肤风格。

一个为 Koishi 设计的群聊分析插件，灵感来源于 `astrbot-qq-group-daily-analysis`，支持多维度统计和智能话题总结。

## 截图

<img src="./screenshots/default.png" width="300" /> <img src="./screenshots/newspaper.png" width="300" /> <img src="./screenshots/anime.png" width="300" />

## 特性

1. **多维度统计** - 分析群聊的总消息数、参与人数、总字数、最活跃时段、发言排行榜等
2. **智能话题总结** - 集成大语言模型（LLM），自动从聊天记录中总结出核心讨论话题
3. **自然语言对话** - 基于 LLM 能力，用自然语言就可以从指定的时间，关注的话题等进行群分析（如 「群分析 过去三小时都聊了什么话题」）
4. **图片报告** - 将分析结果渲染成美观的图片报告，直观易读（使用 Material Design 3 动态配色系统，支持明暗主题切换）
5. **灵活触发** - 支持通过命令手动触发，也支持通过 CRON 表达式定时自动发送
6. **高度可配置** - 支持群组白名单，自定义定时任务等配置选项

## 部署

在 Koishi 插件市场搜索 `chatluna-group-analysis`，安装后启用即可。

**插件依赖 Puppeteer 和 ChatLuna，请确保已安装并配置了 koishi-plugin-puppeteer 和 koishi-plugin-chatluna 插件。**

## 使用

### 命令

- `群分析 <query: string>` - 分析群聊记录，可以用自然语言指定分析的时间，关键词，或者人物，话题。
- `群分析.启用` - 在发送的群中启用群聊分析
- `群分析.禁用` - 在发送的群中禁用群聊分析

### 配置

- `allowedGroups` - 允许使用此插件的群号列表
- `cronSchedule` - 定时发送报告的 CRON 表达式
- `cronAnalysisDays` - 定时任务分析的天数
- `promptTopic` - 用于话题总结的 Prompt 模板

## 感谢

- [lumia1998/koishi-plugin-group-analysis](https://github.com/lumia1998/koishi-plugin-group-analysis) Fork 的原始项目
- [SXP-Simon/astrbot-qq-group-daily-analysis](https://github.com/SXP-Simon/astrbot-qq-group-daily-analysis) AstrBot 的原始项目灵感来源，部分代码参考。
