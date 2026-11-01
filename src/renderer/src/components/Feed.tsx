import type { ReactNode } from 'react';
import type { ClassEvent } from '@shared/types';
import { hhmmss } from '../lib/format';
import { Empty } from './ui';

const LEVEL_CLASS: Record<string, string> = {
  success: 'feed__dot--ok',
  warn: 'feed__dot--warn',
  error: 'feed__dot--err',
  info: 'feed__dot--info',
};

const PLATFORM_LABEL: Record<string, string> = {
  yuketang: 'YKT',
  chaoxing: 'CX',
};

export function Feed({
  events,
  limit,
  showPlatform = true,
}: {
  events: ClassEvent[];
  limit?: number;
  showPlatform?: boolean;
}): ReactNode {
  const slice = limit ? events.slice(-limit).reverse() : [...events].reverse();
  if (!slice.length) {
    return <Empty title="还没有事件" hint="登录后轮询会开始产生事件" />;
  }
  return (
    <div className="feed">
      {slice.map((e) => (
        <div className="feed__item" key={e.id}>
          <span className="feed__time">{hhmmss(e.at)}</span>
          <span className={`feed__dot ${LEVEL_CLASS[e.level] ?? ''}`} />
          <div className="feed__body">
            <div className="feed__title">{e.title}</div>
            {e.detail && <div className="feed__detail">{e.detail}</div>}
          </div>
          {showPlatform && <span className="feed__platform">{PLATFORM_LABEL[e.platform] ?? e.platform}</span>}
        </div>
      ))}
    </div>
  );
}
