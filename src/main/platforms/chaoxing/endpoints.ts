/**
 * 学习通端点表。
 * 依据高星项目交叉验证：
 *   Samueli924/chaoxing(3.7k)、cxOrz/chaoxing-signin(1.8k)、yuban10703/chaoxingsign、
 *   eric-gitta-moore/chaoxing-sign-app、ColdThunder11/ChaoXingDownload、liuyunfz/chaoxing_tool
 */

export const CX_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 (schild:9d3f2a6c) (device:mi)Language/zh_CN com.chaoxing.mobile/ChaoXingStudy_3_6.2.6_android_phone_1888_58 (@Kalimdor)_1a2b3c4d';

export const cx = {
  login: 'https://passport2.chaoxing.com/fanyalogin',
  loginPage: 'https://passport2.chaoxing.com/login?regFromType=1&refer=http%3A%2F%2Fi.mooc.chaoxing.com',
  home: 'https://i.chaoxing.com/base',
  /** 课程 + 班级（courseId / classId / cpi） */
  courseList: 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1',
  /** 活动列表（签到、作业、讨论都在里面） */
  activeList: (courseId: string, classId: string) =>
    `https://mobilelearn.chaoxing.com/v2/apis/active/student/activelist?fid=0&courseId=${encodeURIComponent(courseId)}&classId=${encodeURIComponent(classId)}&showNotStartedActive=0`,
  /** 活动详情：位置签到坐标、签到码 */
  activeInfo: (activeId: string) =>
    `https://mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo?activeId=${encodeURIComponent(activeId)}`,
  /** 预签到（部分账号需要） */
  preSign: (p: { courseId: string; classId: string; activeId: string; uid: string }) =>
    `https://mobilelearn.chaoxing.com/newsign/preSign?courseId=${encodeURIComponent(p.courseId)}&classId=${encodeURIComponent(p.classId)}&activePrimaryId=${encodeURIComponent(p.activeId)}&general=1&sys=1&ls=1&appType=15&uid=${encodeURIComponent(p.uid)}&ut=s`,
  /** 签到执行 */
  sign: 'https://mobilelearn.chaoxing.com/pptSign/stuSignajax',
  /** 作业任务列表（HTML） */
  workTaskList: (p: { courseId: string; classId: string; cpi: string }) =>
    `https://mooc1-api.chaoxing.com/work/task-list?courseId=${encodeURIComponent(p.courseId)}&classId=${encodeURIComponent(p.classId)}&cpi=${encodeURIComponent(p.cpi)}`,
  coursePage: (courseId: string, classId: string) =>
    `https://mooc1.chaoxing.com/visit/interaction?courseId=${courseId}&clazzid=${classId}`,
} as const;

/** 活动类型 → 签到 */
export const ACTIVE_TYPE_SIGN = new Set([0, 2, 74]);
export const ACTIVE_TYPE_HOMEWORK = 47;
export const ACTIVE_STATUS_ONGOING = 1;

/** 需要人工的签到类型关键词 */
export const MANUAL_SIGN_HINT = /二维码|滑块|验证码|人脸|拍照|notsign|frequency|频繁|refuse|invalid|超时/i;
