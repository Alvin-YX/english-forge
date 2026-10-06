import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { initAuthState } from './stores/auth';
import './styles/index.css';

initAuthState();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// ── PWA Service Worker 注册（仅生产环境） ─────────────────────
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .then((registration) => {
        // 更新检查：每次页面加载触发一次
        registration.update();
        // 已有客户端时立即 claim
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // SW 更新成功后自动 reload（配合 SW 的 skipWaiting）
          window.location.reload();
        });
      })
      .catch((err) => {
        // 注册失败不影响页面使用；仅打日志，不阻塞业务
        console.warn('[pwa] Service Worker 注册失败：', err);
      });
  });
}
