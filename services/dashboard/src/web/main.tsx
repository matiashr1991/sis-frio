import { render } from 'preact';
import { App } from './app';
import './styles.css';

const mountPoint = document.getElementById('app');
if (mountPoint) {
  render(<App />, mountPoint);
}

// Registered only from this authenticated-app entry point — the public
// login page never registers the service worker.
if ('serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
