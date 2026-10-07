/// <reference types="vite/client" />

// Side-effect CSS imports. Vite resolves these at build time; TypeScript needs to be told they are
// modules with no exported shape.
declare module '*.css';
