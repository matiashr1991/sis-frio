import { useEffect } from 'preact/hooks';
import { authError, initLiveDashboard, sites, streamConnected } from './store';
import { SiteCard } from './components/SiteCard';
import { logout } from './api';

export function App() {
  useEffect(() => {
    void initLiveDashboard();
  }, []);

  useEffect(() => {
    if (authError.value) {
      window.location.href = '/login';
    }
  }, [authError.value]);

  const handleLogout = (): void => {
    void logout().finally(() => {
      window.location.href = '/login';
    });
  };

  return (
    <div class="app">
      <header class="app__header">
        <h1>Frio Cold-Room Dashboard</h1>
        <div class="app__controls">
          <span class={`stream-indicator${streamConnected.value ? ' stream-indicator--live' : ''}`}>
            {streamConnected.value ? 'live' : 'connecting…'}
          </span>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main class="app__sites">
        {sites.value.length === 0 && <p class="app__empty">No sites reporting yet.</p>}
        {sites.value.map((site) => (
          <SiteCard key={site.site} site={site} />
        ))}
      </main>
    </div>
  );
}
