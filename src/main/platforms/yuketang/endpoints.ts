/**
 * 雨课堂端点表。
 *
 * 依据开源高星项目源码交叉验证（见 docs/协议依据.md）：
 *  - Niuwh/yuketang-jiaoben、ZaytsevZY/yuketang-helper-auto、MuWinds/yuketangHelperBUU
 *  - heyblackC/yuketangHelper、LetMeFly666/YuketangAutoPlayer、Cat1007/yuketangHelperSCUTLite
 *  - lazytool/yuketang（Python）、FkRain（PowerShell，video-log 心跳形状）
 *
 * 所有路径都是同源相对路径；host 可切换（www / pro / 学校子域）。
 */

export { YT_HOSTS, CHECKIN_SOURCES, PROBLEM_TYPE_LABEL } from '@shared/options';

export const yt = {
  origin: (host: string) => `https://${host}`,
  courseList: (host: string) => `https://${host}/v2/api/web/courses/list?identity=2`,
  onLesson: (host: string) => `https://${host}/api/v3/classroom/on-lesson-upcoming-exam`,
  checkin: (host: string) => `https://${host}/api/v3/lesson/checkin`,
  presentation: (host: string, presentationId: string) =>
    `https://${host}/api/v3/lesson/presentation/fetch?presentation_id=${encodeURIComponent(presentationId)}`,
  presentationActive: (host: string, lessonId: string) =>
    `https://${host}/api/v3/lesson/presentation/active?lessonId=${encodeURIComponent(lessonId)}`,
  problemDetail: (host: string, problemId: string) =>
    `https://${host}/api/v3/lesson/problem/detail?problemId=${encodeURIComponent(problemId)}`,
  answer: (host: string) => `https://${host}/api/v3/lesson/problem/answer`,
  retry: (host: string) => `https://${host}/api/v3/lesson/problem/retry`,
  videoHeartbeat: (host: string) => `https://${host}/video-log/heartbeat/`,
  videoProgress: (host: string) =>
    `https://${host}/video-log/get_video_watch_progress/`,
  exerciseList: (host: string, leafId: string, uvId: string) =>
    `https://${host}/mooc-api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(leafId)}/?term=latest&uv_id=${encodeURIComponent(uvId)}`,
  userCourses: (host: string, uvId: string) =>
    `https://${host}/mooc-api/v1/lms/user/user-courses/?status=1&page=1&no_page=1&term=latest&uv_id=${encodeURIComponent(uvId)}`,
  lessonPage: (host: string, lessonId: string, source: number) =>
    `https://${host}/lesson/fullscreen/v3/${encodeURIComponent(lessonId)}?source=${source}`,
  home: (host: string) => `https://${host}/v2/web/index`,
  wsUrl: (host: string) => `wss://${host}/wsapp/`,
} as const;

/** H5 客户端头（答题接口用） */
export const H5_HEADERS: Record<string, string> = {
  xtbz: 'ykt',
  'X-Client': 'h5',
  'Content-Type': 'application/json; charset=utf-8',
};

/** Web 客户端头（课程/在课接口用） */
export const WEB_HEADERS: Record<string, string> = {
  'university-id': '0',
  'uv-id': '0',
  'X-Client': 'web',
  'Xt-Agent': 'web',
};
