import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard, FinanceService, Session } from './contracts';
import { currentMonth } from './date';
import { configuredBackend, createDemoService } from './backend';
import FinanceApp from './frontend/FinanceApp';
import { Brand } from './frontend/components/common';
import { AppSkeleton, PageSkeleton, SessionLock } from './frontend/components/Skeleton';
import Login from './frontend/pages/Login';
import Welcome from './frontend/pages/Welcome';
import type { FinanceCommands } from './frontend/types';

const ImportView = lazy(() => import('./frontend/pages/ImportView'));
const backend = configuredBackend();
const previewAllowed = import.meta.env.DEV || import.meta.env.MODE === 'demo';

export default function App() {
  const [demo, setDemo] = useState<FinanceService | null>(() =>
    previewAllowed && !backend ? createDemoService() : null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!backend);
  const [online, setOnline] = useState(navigator.onLine);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [welcomeSeen, setWelcomeSeen] = useState(() => localStorage.getItem('finance-welcome-seen') === 'yes');
  const request = useRef(0);
  const service = demo ?? (session ? backend : null);

  useEffect(() => {
    if (!backend) return;
    let active = true;
    let eventReceived = false;
    const unsubscribe = backend.onSessionChange((next) => {
      eventReceived = true;
      if (!next) {
        request.current++;
        setData(null);
      }
      setSession(next);
      setReady(true);
    });
    void backend.session().then((next) => {
      if (active && !eventReceived) {
        setSession(next);
        setReady(true);
      }
    }).catch(() => {
      if (active && !eventReceived) setReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!service) return;
    const id = ++request.current;
    setError('');
    try {
      const result = await service.dashboard(month);
      if (request.current === id) setData(result);
    } catch (failure) {
      if (request.current === id) setError('Não foi possível carregar o painel. Tente novamente em instantes.');
      throw failure;
    }
  }, [service, month]);

  useEffect(() => {
    void refresh().catch(() => {});
    return () => { request.current++; };
  }, [refresh]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function signOut() {
    if (!service) return;
    await service.signOut();
    if (demo) setDemo(null);
    else setSession(null);
    request.current++;
    setData(null);
    setMonth(currentMonth());
  }

  if (!ready) return <SessionLock />;
  if (!online && !demo) {
    return <Status title="Sem conexão">Conecte-se à internet para abrir seu painel financeiro.</Status>;
  }
  if (!service) {
    if (!backend && !previewAllowed) {
      return <Status>O acesso será liberado quando a conta for configurada.</Status>;
    }
    if (!welcomeSeen) return <Welcome onContinue={() => {
      localStorage.setItem('finance-welcome-seen', 'yes');
      setWelcomeSeen(true);
    }} />;
    return <Login
      onSignIn={async (email, password) => {
        if (!backend) throw new Error('Configure o Supabase para fazer login.');
        try {
          await backend.signIn(email.trim(), password);
        } catch {
          throw new Error('Não foi possível entrar. Confira o e-mail e a senha.');
        }
      }}
      onPreview={previewAllowed ? () => setDemo(createDemoService()) : undefined}
    />;
  }
  if (!data) {
    if (!error) return <AppSkeleton />;
    return (
      <Status>
        {error}
        <button className="button" onClick={() => void refresh().catch(() => {})}>Tentar novamente</button>
      </Status>
    );
  }
  const commands: FinanceCommands = {
    history: service.history,
    mutate: service.mutate,
    confirmImport: service.confirmImport,
    saveProfile: service.saveProfile,
    changePassword: service.changePassword,
    dashboard: service.dashboard,
    analysis: service.analysis,
    bankConnections: service.bankConnections,
    assistant: service.assistant,
    push: service.push,
    summaries: service.summaries,
    subscriptions: service.subscriptions,
    refresh,
  };
  return (
    <>
      {error && <div role="alert" className="connection-notice">{error}</div>}
      <FinanceApp
        data={data}
        selectedMonth={month}
        onMonth={(next) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) setMonth(next); }}
        commands={commands}
        preview={Boolean(demo)}
        email={session?.email ?? ''}
        onSignOut={async () => {
          try { await signOut(); }
          catch { setError('Não foi possível encerrar a sessão. Tente novamente.'); }
        }}
        importView={(
          <Suspense fallback={<PageSkeleton label="Abrindo importação…" rows={4} />}>
            <ImportView data={data} month={data.month} loadHistoryPage={commands.history} confirmImport={commands.confirmImport} refresh={refresh} />
          </Suspense>
        )}
      />
    </>
  );
}

function Status({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="boot">
      <Brand />
      {title && <h1>{title}</h1>}
      <div className="boot-message" role="status">{children}</div>
    </main>
  );
}
