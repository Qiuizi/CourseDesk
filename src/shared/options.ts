/** 双平台枚举与选项（主进程 / 渲染进程共用，避免两边漂移） */

export const YT_HOSTS = [
  { value: 'www.yuketang.cn', label: '通用版 www.yuketang.cn' },
  { value: 'pro.yuketang.cn', label: '荷塘雨课堂 pro.yuketang.cn' },
  { value: 'changjiang.yuketang.cn', label: '长江雨课堂 changjiang.yuketang.cn' },
] as const;

/** 进入课堂 URL 的 source 参数（签到渠道指纹） */
export const CHECKIN_SOURCES = [
  { value: 5, label: '网页端「正在上课」提示 (5)' },
  { value: 25, label: '上课提醒 (25)' },
  { value: 1, label: '非 APP 扫二维码 (1)' },
  { value: 21, label: 'APP 扫二维码 (21)' },
  { value: 2, label: '课堂暗号 (2)' },
  { value: 9, label: '小程序分享 (9)' },
  { value: 30, label: '观看直播回放 (30)' },
  { value: 26, label: '分享链接 (26)' },
  { value: 0, label: '其他 (0)' },
] as const;

export const CHECKIN_MODES = [
  { value: 'api', label: '仅调接口（轻量，不建页面）' },
  { value: 'page', label: '仅开课堂页面（页面自身 WS）' },
  { value: 'both', label: '接口 + 页面（推荐）' },
] as const;

export const ANSWER_POLICIES = [
  { value: 'off', label: 'off · 纯人工' },
  { value: 'confirm', label: 'confirm · AI 生成后等我确认' },
  { value: 'auto', label: 'auto · 客观题自动提交' },
] as const;

export const PROBLEM_TYPE_LABEL: Record<number, string> = {
  1: '单选题',
  2: '多选题',
  3: '投票题',
  4: '填空题',
  5: '主观题',
  6: '判断题',
};
