import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './frontend/styles/theme/typography.css';
import './frontend/styles/theme/colors.css';
import './frontend/styles/theme/light.css';
import './frontend/styles/theme/dark.css';
import './frontend/styles/base.css';
import './frontend/styles/components/fields.css';
import './frontend/styles/components/dialog.css';
import './frontend/styles/components/notifications.css';
import { ThemeProvider } from './frontend/theme/ThemeProvider';
import { applyAppIcon, readAppIcon } from './frontend/theme/appIcon';
import App from './App';

applyAppIcon(readAppIcon());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
