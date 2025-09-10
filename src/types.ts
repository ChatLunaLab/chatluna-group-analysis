/**
 * 本文件定义了插件所需的所有数据结构
 */

// OneBot v11 消息对象（简化版，仅包含所需字段）
export interface OneBotMessage {
  message_id: number;
  message_seq: number;
  time: number;
  message: string | any[]; // Koishi 可能会将其解析为元素数组
  raw_message: string;
  sender: {
    user_id: number;
    nickname: string;
    card?: string; // 群名片
  };
}

// 用户统计信息
export interface UserStats {
  userId: number;
  nickname: string;
  messageCount: number;
  charCount: number;
  lastActive: Date;
  avatar?: string; // 添加用户头像
}

// 话题总结
export interface SummaryTopic {
  topic: string;
  contributors: string[];
  detail: string;
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
  memberTitles: any[]; // 添加群友称号
  groupBible: any[]; // 添加群圣经
}

// 数据库存储的消息记录模型
export interface GroupMessage {
  id: number;
  guildId: string;
  userId: string;
  username: string;
  messageId: string;
  content: string;
  timestamp: Date;
}