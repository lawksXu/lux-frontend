import type { ReactNode } from 'react';

export type IconName = 'plus' | 'search' | 'message' | 'arrow-up' | 'arrow-down' | 'arrow-right'
  | 'paperclip' | 'close' | 'panel' | 'menu' | 'edit' | 'refresh' | 'stop' | 'play' | 'settings'
  | 'image' | 'video' | 'file' | 'download' | 'sparkles' | 'check' | 'chevron-right' | 'layers' | 'clock' | 'alert';

const shapes: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  message: <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" />,
  'arrow-up': <path d="M12 20V4m-6 6 6-6 6 6" />,
  'arrow-down': <path d="M12 4v16m-6-6 6 6 6-6" />,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  paperclip: <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10m-2 7-6 6a1 1 0 0 0 2 2l8-8" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" /></>,
  refresh: <><path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 16 5-5 4 4 3-3 6 6" /></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="3" /><path d="m16 9 5-3v12l-5-3" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h5" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="M20 2v4m-2-2h4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  layers: <><path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.1" /></>,
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

export function LuxMark({ className = '' }: { className?: string }) {
  return <svg className={`lux-mark ${className}`} width="32" height="32" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
    <path d="M16 2c0 8-6 14-14 14 8 0 14 6 14 14 0-8 6-14 14-14C22 16 16 10 16 2Z" />
    <circle cx="26" cy="6" r="2" />
  </svg>;
}
