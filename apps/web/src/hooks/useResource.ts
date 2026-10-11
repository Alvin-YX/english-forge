import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  /** 加载失败原因；非空时 data 为 null。空列表（[]）不算失败。 */
  error: string | null;
  reload: () => void;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return '请求失败，请重试';
}

/**
 * 单一数据加载状态机：loading / data / error 三者互斥。
 *
 * 替代各页面里散落的 `catch(() => setX(FALLBACK))` 写法 —— 那样会把
 * 接口失败伪装成成功，用户永远看不到"服务不可用"这个事实。
 */
export function useResource<T>(loader: () => Promise<T>): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // 用 ref 持有 loader，避免调用方每次渲染传新函数都触发重复请求
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((err: unknown) => {
        if (alive) setError(describeError(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
