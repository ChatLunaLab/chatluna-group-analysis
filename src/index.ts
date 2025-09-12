import { Context, Schema } from 'koishi'

// @ts-ignore
const ModelType = { llm: 'llm' };

// 引入 service 的类型定义
import {} from 'koishi-plugin-puppeteer'
import {} from 'koishi-plugin-schedule'

export const name = 'group-analysis'

 // 声明插件依赖的服务
 // 将 scheduler 从必需依赖移动到可选依赖，避免未启用时插件变黄灯
export const inject = {
  required: ['puppeteer', 'chatluna'],
  optional: ['database', 'scheduler'],
}

// 插件的配置项
export interface Config {
  model: string
  promptTopic: string
  promptUserTitles: string
  promptGoldenQuotes: string
  outputFormat: 'image' | 'pdf' | 'text'
  maxMessages: number
  minMessages: number
  maxTopics: number
  maxUserTitles: number
  maxGoldenQuotes: number
  maxUsersInReport: number
  userTitleAnalysis: boolean
  cronSchedule: string
  cronAnalysisDays: number
  debug?: boolean
}

// 使用 Schema 定义配置项的类型和校验规则
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    outputFormat: Schema.union(['image', 'pdf', 'text']).description('默认输出格式。').default('image'),
    maxMessages: Schema.number().description('单次分析的最大消息数量。').default(2000),
    minMessages: Schema.number().description('进行分析所需的最小消息数量。').default(100),
    maxUsersInReport: Schema.number().description('报告中显示的最大活跃用户数量。').default(10),
    userTitleAnalysis: Schema.boolean().description('是否启用用户称号分析（需要消耗更多 Token）。').default(true),
    cronSchedule: Schema.string().description('定时发送分析报告的 CRON 表达式。留空则禁用。例如 "0 22 * * *" 表示每天22点。'),
    cronAnalysisDays: Schema.number().description('定时任务分析的默认天数。').default(1),
  }).description('基础设置'),
  Schema.object({
    model: Schema.dynamic('model').description('ChatLuna 模型名称').required(),
    maxTopics: Schema.number().description('最多生成的话题数量。').default(5),
    maxUserTitles: Schema.number().description('最多生成的用户称号数量。').default(5),
    maxGoldenQuotes: Schema.number().description('最多生成的金句数量。').default(3),
  }).description('LLM 设置'),
  Schema.object({
    promptTopic: Schema.string().description('话题分析的提示词模板。').role('textarea').default(
      `你是一个帮我进行群聊信息总结的助手，生成总结内容时，你需要严格遵守下面的几个准则：
请分析接下来提供的群聊记录，提取出最多{maxTopics}个主要话题。

对于每个话题，请提供：
1. 话题名称（突出主题内容，尽量简明扼要）
2. 主要参与者（最多5人）
3. 话题详细描述（包含关键信息和结论）

注意：
- 对于比较有价值的点，稍微用一两句话详细讲讲，比如不要生成 "Nolan 和 SOV 讨论了 galgame 中关于性符号的衍生情况" 这种宽泛的内容，而是生成更加具体的讨论内容，让其他人只看这个消息就能知道讨论中有价值的，有营养的信息。
- 对于其中的部分信息，你需要特意提到主题施加的主体是谁，是哪个群友做了什么事情，而不要直接生成和群友没有关系的语句。
- 对于每一条总结，尽量讲清楚前因后果，以及话题的结论，是什么，为什么，怎么做，如果用户没有讲到细节，则可以不用这么做。

群聊记录：
{messages}

重要：必须返回标准JSON格式，严格遵守以下规则：
1. 只使用英文双引号 " 不要使用中文引号 " "
2. 字符串内容中的引号必须转义为 \\"
3. 多个对象之间用逗号分隔
4. 不要在JSON外添加任何文字说明

请严格按照以下JSON格式返回，确保可以被标准JSON解析器解析：
[
  {{
    "topic": "话题名称",
    "contributors": ["用户1", "用户2"],
    "detail": "话题描述内容"
  }}
]`
    ),
    promptUserTitles: Schema.string().description('用户称号分析的提示词模板。').role('textarea').default(
      `请为以下群友分配合适的称号和MBTI类型。每个人只能有一个称号，每个称号只能给一个人。

可选称号：
- 龙王: 发言频繁但内容轻松的人
- 技术专家: 经常讨论技术话题的人
- 夜猫子: 经常在深夜发言的人
- 表情包军火库: 经常发表情的人
- 沉默终结者: 经常开启话题的人
- 评论家: 平均发言长度很长的人
- 阳角: 在群里很有影响力的人
- 互动达人: 经常回复别人的人
- ... (你可以自行进行拓展添加)

用户数据：
{users}

请以JSON格式返回，格式如下：
[
  {{
    "name": "用户名",
    "qq": 123456789,
    "title": "称号",
    "mbti": "MBTI类型",
    "reason": "获得此称号的原因"
  }}
]`
    ),
    promptGoldenQuotes: Schema.string().description('金句分析的提示词模板。').role('textarea').default(
      `请从以下群聊记录中挑选出{maxGoldenQuotes}句最具冲击力、最令人惊叹的"金句"。这些金句需满足：
- 核心标准：**逆天的神人发言**，即具备颠覆常识的脑洞、逻辑跳脱的表达或强烈反差感的原创内容
- 典型特征：包含某些争议话题元素、夸张类比、反常规结论、一本正经的"胡说八道"或突破语境的清奇思路，并且具备一定的冲击力，让人印象深刻。

对于每个金句，请提供：
1. 原文内容（完整保留发言细节）
2. 发言人昵称
3. 选择理由（具体说明其"逆天"之处，如逻辑颠覆点/脑洞角度/反差感/争议话题元素）

此外，我将对你进行严格约束：
- 优先筛选 **逆天指数最高** 的内容：发情、性压抑话题 > 争议话题 > 元素级 > 颠覆认知级 > 逻辑跳脱级 > 趣味调侃级，剔除单纯玩梗或网络热词堆砌的普通发言
- 重点标记包含极端类比、反常识论证或无厘头结论的内容，并且包含一定的争议话题元素。

群聊记录：
{messages}

请以JSON格式返回，格式如下：
[
  {{
    "content": "金句原文",
    "sender": "发言人昵称",
    "reason": "选择这句话的理由（需明确说明逆天特质）"
  }}
]`
    ),
  }).description('高级设置'),
])

// 声明数据模型
declare module 'koishi' {
  interface Tables {
    group_analysis_settings: GroupAnalysisSettings
  }
  interface Context {
    config: Config
  }
}

export interface GroupAnalysisSettings {
  id: number
  guildId: string
  enabled: boolean
}

import { AnalysisService } from './service'
import { LLMService } from './llm'
import { RendererService } from './renderer'
import * as Commands from './commands'

// 插件的主体逻辑
export function apply(ctx: Context, config: Config) {
  ctx.config = config;
  
  ctx.model.extend('group_analysis_settings', {
    id: 'unsigned',
    guildId: 'string',
    enabled: 'boolean',
  }, {
    primary: 'id',
    autoInc: true,
  })

  // 注册服务
  ctx.plugin(AnalysisService, config)
  ctx.plugin(LLMService, config)
  ctx.plugin(RendererService)
  
  // 动态更新模型列表
  const getModelNames = (service: any) =>
    service.getAllModels(ModelType.llm).map((m: string) => Schema.const(m))

  const updateSchema = (service: any) => {
    if (!service) return;
    const modelNames = getModelNames(service);
    if (modelNames.length > 0) {
      ctx.schema.set('model', Schema.union(modelNames).description('ChatLuna 模型名称').required())
    } else {
      ctx.schema.set('model', Schema.string().description('ChatLuna 模型名称 (当前无可用模型)').required())
    }
  }

  ctx.on('ready', () => {
    if (ctx.chatluna?.platform) {
      updateSchema(ctx.chatluna.platform)
    }
  })
  // @ts-ignore
  ctx.on('chatluna/model-added', updateSchema)
  // @ts-ignore
  ctx.on('chatluna/model-removed', updateSchema)

  // 加载命令
  ctx.plugin(Commands)

  // 设置定时任务
  ctx.using(['scheduler'], (ctx) => {
    ctx.plugin(require('koishi-plugin-schedule'))
    if (config.cronSchedule) {
      ;(ctx as any).schedule.cron(config.cronSchedule, async () => {
        if (!ctx.database) return;
        await ctx.analysis.executeAutoAnalysisForEnabledGroups();
      });
    }
  });

  ctx.logger.info('群聊分析插件已加载！')
}