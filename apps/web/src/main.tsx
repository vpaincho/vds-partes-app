import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// DS-01 tokens, generated from packages/ui/src/tokens.ts so the values the contrast tests verify are
// the values the browser receives.
import '@vds/ui/tokens.css';
import './styles.css';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
