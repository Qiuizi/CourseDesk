/**
 * 刷课在两种界面里共用的标签/选项/边界，避免 simple 与 dev 两套 UI 各写一份后漂移。
 */

import type { VideoFarmStatus } from '@shared/types';

export const FARM_STATUS_LABEL: Record<VideoFarmStatus, string> = {
  idle: '未开始',
  collecting: '拉取课件中',
  running: '刷课中',
  paused: '已暂停',
  done: '已完成',
  error: '出错暂停',
};

/** 上报倍速：真实播放器支持的范围，1–8 之间取值 */
export const FARM_SPEEDS = [1, 1.5, 2, 4] as const;

export const FARM_SPEED_OPTIONS = FARM_SPEEDS.map((speed) => ({
  value: String(speed),
  label: `${speed}×`,
}));

/** 每批间隔（秒）：下限 3s，上限 120s */
export function clampTickSec(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(120, Math.max(3, n)) : 10;
}

/** 倍速：与服务端/引擎一致的 1–8 */
export function clampFarmSpeed(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 2;
}
