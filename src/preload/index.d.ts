import type { CourseDeskApi } from './index';

declare global {
  interface Window {
    coursedesk: CourseDeskApi;
  }
}

export {};
