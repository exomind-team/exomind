import { version } from '../../src-tauri/tauri.beta.conf.json';

export const betaAppVersion = import.meta.env.VITE_APP_VERSION?.trim() || version;
export const betaBrandLabel = `外心 · ${betaAppVersion.replace(/-(?=(?:alpha|beta))/i, ' ')}`;
