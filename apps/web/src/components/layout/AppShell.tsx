import { Outlet, useLocation } from 'react-router-dom';

import { ErrorBoundary } from '../common/ErrorBoundary';

import { Header } from './Header';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          {/* key 绑当前路由：换页即重置 ErrorBoundary 的捕获状态，避免上一页的
              报错一直盖着新页面。 */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
