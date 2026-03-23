import type { Category } from './settings-types';

export const DESKTOP_TAB_CONFIG: Array<{
  key: string;
  label: string;
  categories: Category[];
}> = [
  { key: 'appearance', label: '外观主题', categories: ['appearance'] },
  { key: 'focus', label: '专注设置', categories: ['timer', 'feedback'] },
  { key: 'input', label: '输入', categories: ['input'] },
  { key: 'services', label: '服务', categories: ['ai', 'sync'] },
  { key: 'data', label: '数据', categories: ['data'] },
  { key: 'developer', label: '开发者', categories: ['developer'] },
  { key: 'more', label: '更多', categories: ['more'] },
  { key: 'about', label: '关于', categories: ['about'] },
  { key: 'danger', label: '危险区域', categories: ['danger'] },
];
