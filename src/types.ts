/**
 * 本文件定义了插件所需的所有数据结构
 */

// OneBot v11 消息对象（简化版）
export interface OneBotMessage {
  message_id: number;
  message_seq: number;
  time: number;
  message: string | any[];
  raw_message: string;
  sender: {
    user_id: number;
    nickname: string;
    card?: string;
  };
}

// 用户统计信息
export interface UserStats {
  userId: number;
  nickname: string;
  messageCount: number;
  charCount: number;
  lastActive: Date;
  avatar?: string;
  replyCount: number;
  atCount: number;
  emojiStats: Record<string, number>;
  nightRatio: number;
  avgChars: number;
  replyRatio: number;
  nightMessages: number;
  activeHours: Record<number, number>;
}

// 话题总结
export interface SummaryTopic {
  topic: string;
  contributors: string[];
  detail: string;
}

// 用户称号
export interface UserTitle {
  name: string;
  qq: number;
  title: string;
  mbti: string;
  reason: string;
  avatar?: string;
}

// 金句
export interface GoldenQuote {
  content: string;
  sender: string;
  reason: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}


// 最终的群聊分析报告数据结构
export interface GroupAnalysisResult {
  totalMessages: number;
  totalChars: number;
  totalParticipants: number;
  emojiCount: number;
  mostActiveUser: UserStats | null;
  mostActivePeriod: string;
  userStats: UserStats[];
  topics: SummaryTopic[];
  userTitles: UserTitle[];
  goldenQuotes: GoldenQuote[];
  activeHoursChart: string;
  analysisDate: string;
  groupName: string;
  tokenUsage: TokenUsage;
}
