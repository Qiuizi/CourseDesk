import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界：任一页面渲染抛异常时只损失这一屏，不再整窗白屏。
 * 只记录信息，不上报网络（本地工具）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] 渲染异常', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__card">
          <div className="crash__eyebrow">界面异常</div>
          <h1 className="crash__title">这一屏没能画出来</h1>
          <p className="crash__hint">
            后台任务（监控、签到提醒、刷课队列）仍在主进程里运行，界面出错不影响它们。
          </p>
          <pre className="crash__detail">{error.message || String(error)}</pre>
          <div className="crash__actions">
            <button type="button" className="crash__btn" onClick={this.reset}>
              重试这一屏
            </button>
            <button type="button" className="crash__btn crash__btn--ghost" onClick={this.reload}>
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}
