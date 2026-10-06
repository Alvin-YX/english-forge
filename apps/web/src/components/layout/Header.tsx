import { useNavigate } from 'react-router-dom';

import { Button } from '../ui/Button';
import { useAuthStore } from '../../stores/auth';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
      <div className="text-sm text-slate-500">
        <span className="font-medium text-slate-700">EnglishForge</span> ·
        <span className="ml-2 hidden sm:inline">每日进步一点点 🌱</span>
      </div>
      <div className="flex items-center gap-3">
        {user ? (
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="hidden text-sm font-medium text-slate-700 sm:inline">{user.displayName}</span>
          </div>
        ) : null}
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          退出
        </Button>
      </div>
    </header>
  );
}
