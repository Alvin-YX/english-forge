import { Spinner } from '../ui/Spinner';

interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = '加载中…' }: PageLoaderProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
      <Spinner size="lg" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
