import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 应用级渲染错误兜底。
 *
 * 🔴 为什么必须有这一层：本仓库此前完全没有 ErrorBoundary，任何一个页面在
 * render 期间抛异常（例如把后端返回的分页对象当数组调 `.slice()`），
 * React 18 会直接卸载整棵组件树，用户看到的是**白屏**，只能关掉浏览器重登——
 * 这是 2026-10-13 用户实测报告的「点击跟读白屏」的直接机制。
 *
 * 加了这个边界之后，单页崩溃只影响该子树：展示可读的报错界面 + 一键回首页，
 * 应用外壳（侧边栏/导航）仍然可用。
 *
 * 注意职责边界：这里只兜「render 期异常」。数据请求失败属于业务错误态，
 * 仍应由 `useResource` 的 error 分支 + `StateView` 处理，不要往这里塞。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 生产日志只保留 error/warn 级别；这里是唯一能拿到堆栈的地方，必须打印。
    console.error('[ErrorBoundary] 页面渲染崩溃：', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleHome = (): void => {
    this.setState({ error: null });
    window.location.assign('/today');
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 text-5xl">😵</div>
        <h2 className="text-xl font-bold text-slate-900">这个页面出错了</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          页面渲染时遇到了未预期的错误。其它页面不受影响，可以返回今日任务继续学习。
        </p>

        <div className="mt-4 max-w-lg break-all rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-600">
          <span className="font-mono">{error.message}</span>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={this.handleHome}
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700"
          >
            回到今日任务
          </button>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            重试本页
          </button>
        </div>

        <p className="mt-6 text-xs text-slate-400">
          若反复出现，请刷新页面；仍不行请告诉家长：{error.message.slice(0, 80)}
        </p>
      </div>
    );
  }
}
