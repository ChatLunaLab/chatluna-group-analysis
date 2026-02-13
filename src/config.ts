import { Schema } from 'koishi'

export interface GroupListener {
    selfId: string
    channelId: string
    platform: string
    guildId?: string
    enabled: boolean
}

const GroupListener: Schema<GroupListener> = Schema.object({
    platform: Schema.string().required().description('平台名称'),
    selfId: Schema.string().required().description('机器人 ID'),
    channelId: Schema.string().required().description('频道 ID'),
    guildId: Schema.string().description('群组 ID'),
    enabled: Schema.boolean().default(true).description('是否在此频道启用监听')
})

export interface Config {
    enableAllGroupsByDefault: boolean
    listenerGroups: GroupListener[]
    wordsFilter: string[]
    userFilter: string[]
    personaUserFilter: string[]
    model: string
    smallModel?: string
    alwaysPersistMessages: boolean
    retentionDays: number
    promptTopic: string
    promptUserTitles: string
    promptGoldenQuotes: string
    promptUserPersona: string
    promptQueryParser: string
    promptQueryChat: string
    outputFormat: 'image' | 'pdf' | 'text'
    maxMessages: number
    temperature: number
    minMessages: number
    maxTopics: number
    maxUserTitles: number
    maxGoldenQuotes: number
    maxUsersInReport: number
    userTitleAnalysis: boolean
    groupAnalysisCacheMinutes: number
    cronSchedule: string
    cronAnalysisDays: number
    personaAnalysisMessageInterval: number
    personaCacheLifetimeDays: number
    personaLookbackDays: number
    personaMaxMessages: number
    personaMinMessages: number
    registerTools: boolean
    theme: 'light' | 'dark' | 'auto'
    skin: string

    debug?: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        enableAllGroupsByDefault: Schema.boolean()
            .default(false)
            .description(
                '为所有群默认启用群分析。开启后与 listenerGroups 不兼容（将忽略其配置）；即使开启并启用数据库记录，数据库也只会记录实际触发的群消息。'
            ),
        listenerGroups: Schema.array(GroupListener)
            .role('table')
            .description('数据库监听规则列表。')
            .default([]),
        cronSchedule: Schema.string().description(
            '定时发送分析报告的 CRON 表达式。留空则禁用。例如 "0 22 * * *" 表示每天22点。'
        ),
        cronAnalysisDays: Schema.number()
            .description('定时任务分析的默认天数。')
            .default(1),
        registerTools: Schema.boolean()
            .default(true)
            .description('是否注册用户画像和群聊分析工具到 ChatLuna。')
    }).description('基础设置'),
    Schema.object({
        alwaysPersistMessages: Schema.boolean()
            .description(
                '启用后，无论平台能力如何都会将监听到的消息写入数据库。'
            )
            .default(false),
        retentionDays: Schema.number()
            .description('数据库中缓存消息的最长保留时间（天）。')
            .min(1)
            .default(7)
    }).description('消息存储设置'),
    Schema.object({
        maxMessages: Schema.number()
            .description('单次分析的最大消息数量。')
            .default(2000),
        minMessages: Schema.number()
            .description('进行分析所需的最小消息数量。')
            .min(10)
            .max(1000)
            .default(100),
        maxUsersInReport: Schema.number()
            .description('报告中显示的最大活跃用户数量。')
            .default(10),
        userTitleAnalysis: Schema.boolean()
            .description('是否启用用户称号分析（需要消耗更多 Token）。')
            .default(true),
        groupAnalysisCacheMinutes: Schema.number()
            .description('群分析缓存结果的保留分钟数。超过此时长后会重新分析。')
            .min(0)
            .default(5),
        wordsFilter: Schema.array(String)
            .role('table')
            .description('过滤词列表。消息内含有此词语时将不会记入统计消息。')
            .default([]),
        userFilter: Schema.array(String)
            .role('table')
            .description('用户过滤列表。在群分析中忽略这些用户 ID 的消息。')
            .default([]),
        maxTopics: Schema.number()
            .description('最多生成的话题数量。')
            .default(5),
        maxUserTitles: Schema.number()
            .description('最多生成的用户称号数量。')
            .default(6),
        maxGoldenQuotes: Schema.number()
            .description('最多生成的金句数量。')
            .default(3)
    }).description('群分析设置'),
    Schema.object({
        outputFormat: Schema.union([
            Schema.const('image').description('图片'),
            Schema.const('pdf').description('PDF'),
            Schema.const('text').description('文本')
        ])
            .description('默认输出格式。')
            .default('image'),
        theme: Schema.union([
            Schema.const('light').description('亮色主题'),
            Schema.const('dark').description('暗色主题'),
            Schema.const('auto').description('自动模式')
        ])
            .description(
                '渲染模板的主题。auto 会在 19:00-06:00 期间自动切换到暗色模式。'
            )
            .default('auto'),
        skin: Schema.union([
            Schema.const('md3').description('Material Design 3'),
            Schema.const('anime').description('二次元风格'),
            Schema.const('newspaper').description('报纸风格'),
            Schema.const('art').description('艺术风格'),
            Schema.const('scrapbook').description('手账风格')
        ])
            .description('渲染界面皮肤。')
            .default('md3')
    }).description('分析渲染设置'),
    Schema.object({
        model: Schema.dynamic('model')
            .description('使用的 LLM 模型。')
            .required(),
        smallModel: Schema.dynamic('model').description(
            '用于请求解析的小模型（未设置则使用默认模型）。'
        ),
        temperature: Schema.number()
            .description('生成的温度。')
            .min(0)
            .max(2)
            .default(1.5)
    }).description('LLM 设置'),
    Schema.object({
        personaUserFilter: Schema.array(String)
            .role('table')
            .description(
                '用户画像过滤列表。这些用户 ID 将无法分析用户画像（包括自动分析和手动命令调用）。'
            )
            .default([]),
        personaAnalysisMessageInterval: Schema.number()
            .description(
                '跨群用户画像分析的触发阈值，新消息累计达到该条数时尝试更新画像。设置为 0 则关闭自动画像分析。'
            )
            .min(0)
            .default(50),
        personaCacheLifetimeDays: Schema.number()
            .description(
                '用户画像缓存结果的保留天数。超过此时长后再次请求会重新生成画像。'
            )
            .min(0)
            .default(3),
        personaLookbackDays: Schema.number()
            .description('画像分析回溯的天数窗口（建议保持在 1-4 天）。')
            .min(1)
            .max(7)
            .default(2),
        personaMaxMessages: Schema.number()
            .description('单次用户画像分析最多提取的历史消息数量。')
            .min(100)
            .max(1500)
            .default(400),
        personaMinMessages: Schema.number()
            .description('触发用户画像分析所需的最少历史消息数量。')
            .min(10)
            .default(20)
    }).description('用户画像设置'),
    Schema.object({
        promptTopic: Schema.string()
            .description('话题分析的提示词模板。')
            .role('textarea')
            .default(
                `你是一个帮我进行群聊信息总结的助手，生成总结内容时，你需要严格遵守下面的几个准则：
请分析接下来提供的群聊记录，提取出最多{maxTopics}个主要话题。根据你自己的价值观判断需要的主要话题。越逆天越好。

对于每个话题，请提供：
1. 话题名称（突出主题内容，尽量简明扼要）
2. 主要参与者（最多5人）
3. 话题详细描述（包含关键信息和结论）

注意：
- 对于比较有价值的点，稍微用一两句话详细讲讲，比如不要生成 "Nolan 和 SOV 讨论了 galgame 中关于性符号的衍生情况" 这种宽泛的内容，而是生成更加具体的讨论内容，让其他人只看这个消息就能知道讨论中有价值的，有营养的信息。
- 对于其中的部分信息，你需要特意提到主题施加的主体是谁，是哪个群友做了什么事情，而不要直接生成和群友没有关系的语句。
- 对于每一条总结，尽量讲清楚前因后果，以及话题的结论，是什么，为什么，怎么做，如果用户没有讲到细节，则可以不用这么做。
- 对于话题的描述内容，请在里面使用用户的昵称而不是用户的ID，避免输出用户ID和字符到话题描述内容中。

用户查询：{query}
用户关注关键词：{keywords}
用户关注话题：{topics}
用户关注昵称：{nicknames}
目标时间范围：{timeRange}

要求：生成内容时需优先围绕上述关键词、话题、昵称与时间范围；若信息不足，请在话题描述中明确指出缺口。

群聊记录：
{messages}

请严格按照以下 YAML 格式返回，放在 markdown 代码块中：
\`\`\`yaml
- topic: "话题名称"
  contributors:
    - "用户1 (用户ID)"
    - "用户2 (用户ID)"
  detail: |-
    话题描述内容（支持多行文本，
    保留换行符，适合多段落描述，不要在里面添加任何markdown语法，请使用纯文本）
\`\`\``
            ),
        promptUserTitles: Schema.string()
            .description('用户称号分析的提示词模板。')
            .role('textarea')
            .default(
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

用户查询：{query}
用户关注关键词：{keywords}
用户关注话题：{topics}
用户关注昵称：{nicknames}
目标时间范围：{timeRange}

要求：生成内容时需优先围绕上述关键词、话题、昵称与时间范围；不相关的用户不要入选。如果为空的，请忽略。

用户数据：
{users}

请严格按照以下 YAML 格式返回，放在 markdown 代码块中：
\`\`\`yaml
- name: "用户名"
  id: 123456789
  title: "称号"
  mbti: "MBTI类型"
  reason: |-
    获得此称号的原因（支持多行文本，不要在里面添加任何markdown语法，请使用纯文本）
\`\`\``
            ),
        promptGoldenQuotes: Schema.string()
            .description('金句分析的提示词模板。')
            .role('textarea')
            .default(
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

用户查询：{query}
用户关注关键词：{keywords}
用户关注话题：{topics}
用户关注昵称：{nicknames}
目标时间范围：{timeRange}

要求：生成内容时需优先围绕上述关键词、话题、昵称与时间范围；不相关的金句请过滤。如果为空的，请忽略。

群聊记录：
{messages}

请严格按照以下 YAML 格式返回，放在 markdown 代码块中：
\`\`\`yaml
- content: |-
    金句原文
  sender: "发言人昵称（注意不是 ID）"
  reason: |-
    选择这句话的理由（需明确说明逆天特质，不要在里面添加任何markdown语法，请使用纯文本）
\`\`\``
            ),
        promptUserPersona: Schema.string()
            .description('跨群用户画像分析的提示词模板。')
            .role('textarea')
            .default(
                `你是一名专业的社群观察员，请基于提供的用户聊天记录，给出该用户的最新画像总结，并在更新时严谨比对历史画像。

要求：
1. 先阅读「历史画像」，理解已有结论。
2. 再阅读「最新聊天记录」，分析过去 {personaLookbackDays} 天内该用户在多个群的活跃情况。
3. 如果历史画像为空，则从零开始构建；否则基于历史画像。融合生成新的用户画像。
4. 输出时请确保条理清晰、总结恰当，中性。输出的 yaml 内容里，为纯文本格式，不要包含 markdown 标记，如 ** 加粗。
5. 注意 evidence，需要选出 15-25 句最具冲击力、最令人惊叹的"金句"。这些金句需满足，**逆天的神人发言**，即具备颠覆常识的脑洞、逻辑跳脱的表达或强烈反差感的原创内容。

历史画像：{previousAnalysis}
最新聊天记录：{messages}
用户角色: {roles}

请严格按照以下 YAML 格式返回，放在代码块中：
\`\`\`yaml
- userId: "{userId}"
  summary: |-
    对整体聊天记录的提炼（性格特点，发言语气等，几段话）（如果和之前的用户画像合一起，太多了的话，超过了300字，需要精简）
  keyTraits:
    - "核心性格特质（列出几点）" （如果和之前的用户画像合一起，太多了的话，需要精简，用字符串围起来）
  interests:
    - "关注的主题或爱好" （如果和之前的用户画像合一起，太多了的话，需要精简，用字符串围起来）
  communicationStyle: |-
    描述其发言风格和情绪倾向，几段话。（如果和之前的用户画像合一起，太多了的话，超过了150字，需要精简，用字符串围起来）
  evidence:
    - "对应上面聊天记录中提供的 id，输出纯 id 的引用"（加入多条组成数组，引用到的聊天消息或者你自己挑选的逆天语句）
  lastMergedFromHistory: true/false（是否成功融合历史画像）
\`\`\``
            )
    }).description('高级设置'),
    Schema.object({
        promptQueryParser: Schema.string()
            .description('群分析自然语言解析提示词模板。')
            .role('textarea')
            .default(
                `你是群聊分析助手，负责将用户的自然语言请求解析成结构化查询。

已知信息：
- 当前时间：{currentTime}
- 当前时区：{timeZone}
- 平台：{platform}
- 群聊：{groupName} (guildId: {guildId}, channelId: {channelId})
- 用户：{currentUserName} (userId: {currentUserId})
- 用户请求：{query}

## 请识别以下信息：

1. **action**（3选1）：

   **只分析** - 用户只想了解群聊的信息、事实、数据或总结，不需要你的主观意见或对话
   示例：
   - "最近三小时聊了什么"
   - "今天有哪些话题"
   - "过去一周谁最活跃"
   - "帮我总结昨天的讨论"
   - "xx说过什么"（查证式提问）

   **分析加对话** - 用户想要基于分析结果的进一步对话或评论，通常包含：询问观点、性格分析、提出见解、引导讨论等
   示例：
   - "分析xx的性格"
   - "告诉我xx这几个小时的话题是什么"
   - "xx最近在关注什么"
   - "你觉得这个讨论怎么样"
   - "总结一下，xx在群里是什么角色"
   - "分析一下群里最近的气氛"（带有观点要求）

   **只对话** - 用户不需要新的分析，基于已知信息进行聊天或跟进前面的对话
   示例：
   - "你怎么看"（承上文，指代已有分析）
   - "这个话题怎么深入"
   - "你再补充一下"
   - "有其他看法吗"
   - "为什么这样说"

2. 关键词 keywords（用户关注的关键词或实体，没有则返回空数组）
3. 话题 topics（用户关注的主题或领域，没有则返回空数组）
4. 昵称 nicknames（用户关注的群友昵称，没有则返回空数组）
5. 目标时间 targetTime：如涉及时间，请输出绝对时间（YYYY-MM-DD HH:mm:ss）；否则留空字符串。可以补充 description。

请严格按照 YAML 输出，放在 markdown 代码块中：
\`\`\`yaml
action: 只分析
keywords:
  - "关键词1"
topics:
  - "话题1"
nicknames:
  - "奶龙"
targetTime:
  description: "最近三小时"
  startTime: "2026-02-01 12:00:00"
  endTime: "2026-02-01 15:00:00"
\`\`\``
            ),
        promptQueryChat: Schema.string()
            .description('群分析对话回复提示词模板。')
            .role('textarea')
            .default(
                `你是群聊分析对话助手，需要基于提供的分析结果回答用户的问题。

已知信息：
- 当前时间：{currentTime}
- 群聊：{groupName} (guildId: {guildId}, channelId: {channelId})
- 用户：{currentUserName} (userId: {currentUserId})
- 用户请求：{query}

分析结果（纯文本）：
{analysisResult}

要求：
1. 结合分析结果回答用户问题，必要时引用关键事实或趋势。
2. 若分析结果不足以回答，请说明限制，并给出合理的保守回答。
3. 回复简洁、中立，不要输出 YAML 或 markdown 代码块。
`
            )
    }).description('高级设置')
])

export const name = 'chatluna-group-analysis'

export const inject = {
    required: ['puppeteer', 'chatluna', 'database'],
    optional: ['cron']
}
