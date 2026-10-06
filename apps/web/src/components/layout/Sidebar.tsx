import { NavLink } from 'react-router-dom';

import { useAuthStore } from '../../stores/auth';

type NavItem = {
  to: string;
  label: string;
  icon: string;
};

const mainNav: NavItem[] = [
  { to: '/today', label: '今日学习', icon: '📚' },
  { to: '/streak', label: '连击', icon: '🔥' },
  { to: '/heatmap', label: '热力图', icon: '🗓️' },
];

const practiceNav: NavItem[] = [
  { to: '/practice/word-card', label: '词卡', icon: '🃏' },
  { to: '/practice/spelling', label: '拼写', icon: '⌨️' },
  { to: '/practice/dictation', label: '听写', icon: '✍️' },
];

const otherNav: NavItem[] = [
  { to: '/errorbook', label: '错题本', icon: '📕' },
  { to: '/parent/dashboard', label: '家长后台', icon: '👪' },
  { to: '/profile', label: '我的', icon: '⚙️' },
];

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-primary-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`
          }
        >
          <span aria-hidden>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const user = useAuthStore((s) => s.user);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex h-16 items-center gap-2 border-b border-slate-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-lg font-bold text-white">
          E
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">EnglishForge</p>
          <p className="text-xs text-slate-500">Learn · Play · Grow</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">学习</p>
          <NavGroup items={mainNav} />
        </div>
        <div>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">练习</p>
          <NavGroup items={practiceNav} />
        </div>
        <div>
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">更多</p>
          <NavGroup items={otherNav} />
        </div>
      </div>

      {user ? (
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-base font-bold text-primary-700">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">{user.displayName}</p>
              <p className="truncate text-xs text-slate-500">{user.username}</p>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
