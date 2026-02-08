/// <reference types="vite/client" />

interface Window {
  __TAURI__: {
    [key: string]: unknown;
  };
}