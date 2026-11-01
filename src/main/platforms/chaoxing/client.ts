/**
 * 学习通协议客户端。
 *
 * 与雨课堂不同，学习通没有可复用的 Bearer：纯 Cookie 会话（persist 分区）。
 * 因此"登录"有两条路：
 *   1. 账号密码 → /fanyalogin（AES 加密后提交），cookie 落进分区；
 *   2. 内嵌浏览器窗口扫码/验证码登录，cookie 同样落进分区。
 * 两条路的后续请求完全一致。
 */

import { request, requestWithRetry, describeHttpFailure, mainSession } from '../../core/net';
import { log } from '../../core/log';
import { ACTIVE_STATUS_ONGOING, ACTIVE_TYPE_SIGN, CX_MOBILE_UA, MANUAL_SIGN_HINT, cx } from './endpoints';
import { aesEncrypt } from './crypto';
import type { ChaoxingActive, ChaoxingSettings, Course, HomeworkItem, SignMethod, SignRecord } from '@shared/types';
import { num, str } from '../yuketang/normalize';

function mobileHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'user-agent': CX_MOBILE_UA,
    'X-Requested-With': 'com.chaoxing.mobile',
    accept: 'application/json, text/plain, */*',
    ...extra,
  };
}

export class ChaoxingClient {
  /* ------------------------------------------------------------ 登录 */

  async login(phone: string, password: string): Promise<{ ok: boolean; msg: string }> {
    if (!phone || !password) return { ok: false, msg: '需要手机号与密码' };
    const body = new URLSearchParams({
      fid: '-1',
      uname: aesEncrypt(phone),
      password: aesEncrypt(password),
      refer: 'http%3A%2F%2Fi.mooc.chaoxing.com',
      t: 'true',
      forbidotherlogin: '0',
      validate: '',
      doubleFactorLogin: '0',
      independentId: '0',
    });
    const res = await request(cx.login, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'user-agent': CX_MOBILE_UA,
        'X-Requested-With': 'com.chaoxing.mobile',
      },
      body,
    });
    if (res.status === 0) return { ok: false, msg: describeHttpFailure(res) };
    const json = (res.json ?? {}) as Record<string, unknown>;
    const status = json.status === true || String(json.status) === 'true';
    if (!status) {
      const msg = str(json.mes ?? json.msg ?? json.message) || '账号或密码不正确';
      log.warn('cx', `登录失败：${msg}`);
      return { ok: false, msg };
    }
    log.info('cx', '账号密码登录成功');
    return { ok: true, msg: 'ok' };
  }

  /** 登录态探测：课程接口能返回 JSON 就当已登录（不依赖 DOM 猜测） */
  async probe(): Promise<{ logged: boolean; userName?: string; msg?: string }> {
    const res = await request(cx.courseList, { headers: mobileHeaders() });
    if (res.status === 0) return { logged: false, msg: describeHttpFailure(res) };
    if (res.status === 302) return { logged: false, msg: '被重定向到登录页' };
    const text = res.text.trim();
    if (!text) return { logged: false, msg: '空响应' };
    if (text.startsWith('<')) return { logged: false, msg: '返回 HTML（多为登录页）' };
    const json = res.json as Record<string, unknown> | null;
    if (!json) return { logged: false, msg: '响应非 JSON' };
    const channelList = Array.isArray(json.channelList) ? json.channelList : [];
    if (channelList.length === 0) {
      return { logged: false, msg: '课程列表为空（可能未登录）' };
    }
    return { logged: true, userName: str(json.name ?? json.userName) || undefined };
  }

  async logout(): Promise<void> {
    await mainSession().clearStorageData({ origin: 'https://passport2.chaoxing.com' });
    for (const origin of [
      'https://mooc1-api.chaoxing.com',
      'https://mobilelearn.chaoxing.com',
      'https://i.chaoxing.com',
      'https://mooc1.chaoxing.com',
    ]) {
      await mainSession().clearStorageData({ origin }).catch(() => undefined);
      const list = await mainSession().cookies.get({ url: origin }).catch(() => []);
      await Promise.all(
        list.map((c) => {
          const rawHost = c.domain ?? '';
          const host = rawHost.startsWith('.') ? rawHost.slice(1) : rawHost;
          return mainSession()
            .cookies.remove(`https://${host}${c.path}`, c.name)
            .catch(() => undefined);
        }),
      );
    }
    log.info('cx', '已清除学习通登录态');
  }

  /* ------------------------------------------------------------ 课程 */

  async courses(): Promise<Course[]> {
    const res = await requestWithRetry(cx.courseList, { headers: mobileHeaders() });
    const json = res.json as Record<string, unknown> | null;
    if (!json) return [];
    const out: Course[] = [];
    const seen = new Set<string>();
    const channelList = Array.isArray(json.channelList) ? json.channelList : [];
    for (const ch of channelList) {
      const content = (ch as Record<string, unknown>).content as Record<string, unknown> | undefined;
      if (!content) continue;
      const course = (content.course as Record<string, unknown>) ?? {};
      const courseId = str(course.dataId ?? course.courseId ?? course.id);
      const classId = str(course.classId ?? course.clazzId ?? course.clazzid);
      const name = str(course.title ?? course.name ?? course.courseName) || `课程 ${courseId}`;
      const key = `${courseId}:${classId}`;
      if (!courseId || seen.has(key)) continue;
      seen.add(key);
      out.push({
        platform: 'chaoxing',
        id: courseId,
        classId,
        name: name.replace(/<[^>]+>/g, '').trim(),
        teacher: str(course.teacherName ?? course.teacher),
        extra: { cpi: str(content.cpi ?? course.cpi ?? '0') },
      });
    }
    log.info('cx', `课程 ${out.length} 门`);
    return out;
  }

  /* ------------------------------------------------------------ 活动（签到） */

  async activeList(course: Course): Promise<ChaoxingActive[]> {
    const classId = course.classId ?? '';
    if (!classId) return [];
    const res = await request(cx.activeList(course.id, classId), { headers: mobileHeaders() });
    const json = res.json as Record<string, unknown> | null;
    if (!json) return [];
    const list = pickArray(json, ['activeList', 'list', 'data', 'activeListData']);
    const out: ChaoxingActive[] = [];
    for (const item of list) {
      const o = item as Record<string, unknown>;
      const id = str(o.id ?? o.activeId ?? o.activePrimaryId);
      if (!id) continue;
      const activeType = num(o.activeType ?? o.type, -1);
      out.push({
        id,
        courseId: course.id,
        classId,
        courseName: course.name,
        title: stripHtml(str(o.nameOne ?? o.name ?? o.title)) || `活动 ${id}`,
        activeType,
        status: num(o.status, 0),
        ongoing: num(o.status, 0) === ACTIVE_STATUS_ONGOING,
        startedAt: num(o.startTime ?? o.starttime, 0) || undefined,
        method: 'unknown',
      });
    }
    return out;
  }

  async activeInfo(activeId: string): Promise<{
    signcode: string;
    locationText: string;
    latitude: string;
    longitude: string;
    uid: string;
    otherInfo: Record<string, unknown>;
    raw: unknown;
  }> {
    const res = await request(cx.activeInfo(activeId), { headers: mobileHeaders() });
    const json = res.json as Record<string, unknown> | null;
    const data = (json?.data as Record<string, unknown>) ?? json ?? {};
    return {
      signcode: str(data.signcode ?? data.signCode ?? data.code),
      locationText: str(data.locationText ?? data.location ?? data.address),
      latitude: str(data.locationLatitude ?? data.latitude),
      longitude: str(data.locationLongitude ?? data.longitude),
      uid: str(data.uid ?? data.fid),
      otherInfo: (data.otherInfo as Record<string, unknown>) ?? {},
      raw: json,
    };
  }

  /** 判定签到方式：位置 / 手势或签到码 / 二维码(转人工) / 普通 */
  async resolveMethod(active: ChaoxingActive): Promise<SignMethod> {
    const info = await this.activeInfo(active.id);
    const other = JSON.stringify(info.otherInfo ?? {});
    if (info.latitude && info.longitude) return 'location';
    if (/enc|qrcode/i.test(other)) return 'qr';
    if (info.signcode) return /^[0-9]{4,8}$/.test(info.signcode) ? 'code' : 'gesture';
    return 'normal';
  }

  /**
   * 执行签到。
   * 关键点：位置签到必须带教师指定坐标（否则服务端按"超出范围"拒绝），
   * 教师未指定才用设置里的默认坐标；失败后补一次 preSign 再签（部分账号要求）。
   */
  async sign(
    active: ChaoxingActive,
    settings: ChaoxingSettings,
    uidHint = '',
  ): Promise<SignRecord> {
    const method = await this.resolveMethod(active).catch(() => 'normal' as SignMethod);
    const info = await this.activeInfo(active.id).catch(() => null);
    const params = new URLSearchParams({
      activeId: active.id,
      address: info?.locationText || settings.location.address,
      latitude: info?.latitude || settings.location.latitude,
      longitude: info?.longitude || settings.location.longitude,
      fid: '0',
      appType: '15',
      ifTiJiao: '1',
    });
    if (info?.signcode) params.set('code', info.signcode);

    const attempt = async (): Promise<string> => {
      const res = await request(cx.sign, {
        method: 'POST',
        headers: mobileHeaders({ 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
        body: params,
      });
      return (res.text || res.error || '').trim();
    };

    let resp = await attempt();
    if (resp.toLowerCase().includes('success')) {
      return record(active, method, true, '签到成功');
    }
    // preSign 兜底
    const uid = uidHint || info?.uid || '';
    if (uid) {
      await request(cx.preSign({ courseId: active.courseId, classId: active.classId, activeId: active.id, uid }), {
        headers: mobileHeaders(),
      }).catch(() => undefined);
      resp = await attempt();
      if (resp.toLowerCase().includes('success')) {
        return record(active, method, true, '签到成功（preSign 兜底）');
      }
    }
    const manual = MANUAL_SIGN_HINT.test(resp);
    log.warn('cx', `签到失败 ${active.title}: ${resp.slice(0, 160)}`);
    return record(active, method, false, manual ? `需人工处理：${resp.slice(0, 80)}` : resp.slice(0, 120) || '未知失败');
  }

  /* ------------------------------------------------------------ 作业 */

  async workList(course: Course): Promise<HomeworkItem[]> {
    if (!course.classId) return [];
    const res = await request(
      cx.workTaskList({ courseId: course.id, classId: course.classId, cpi: course.extra?.cpi ?? '0' }),
      { headers: mobileHeaders() },
    );
    const html = res.text;
    if (!html || !html.includes('<')) return [];
    const items: HomeworkItem[] = [];
    const blocks = html.split(/<li[\s>]/i).slice(1);
    for (const block of blocks) {
      const idMatch = block.match(/taskrefId["'=:\s]*?(\d{4,})/i) ?? block.match(/workId["'=:\s]*?(\d{4,})/i);
      if (!idMatch) continue;
      const statusMatch = block.match(/(未交|已完成|待批阅|已提交|未开始|已过期)/);
      const leftMatch = block.match(/剩余[\d小时分钟秒天]+/) ?? block.match(/class="fr"[^>]*>([^<]+)/);
      const titleMatch = block.match(/<p[^>]*>([^<]{2,80})<\/p>/) ?? block.match(/title="([^"]{2,80})"/);
      items.push({
        platform: 'chaoxing',
        id: idMatch[1],
        courseName: course.name,
        title: titleMatch ? stripHtml(titleMatch[1]) : `作业 ${idMatch[1]}`,
        statusText: statusMatch ? statusMatch[1] : '未知',
        leftText: leftMatch ? stripHtml(leftMatch[0].replace(/^class="fr"[^>]*>/, '')) : '',
        leftHours: parseLeftHours(leftMatch ? leftMatch[0] : ''),
        url: cx.coursePage(course.id, course.classId ?? ''),
      });
    }
    return items;
  }
}

/* ------------------------------------------------------------------ */
/* 纯函数                                                              */
/* ------------------------------------------------------------------ */

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseLeftHours(text: string): number | null {
  if (!text) return null;
  const day = text.match(/(\d+)\s*天/);
  const hour = text.match(/(\d+)\s*小时/);
  const min = text.match(/(\d+)\s*分钟/);
  if (!day && !hour && !min) return null;
  return (day ? Number(day[1]) * 24 : 0) + (hour ? Number(hour[1]) : 0) + (min ? Number(min[1]) / 60 : 0);
}

function record(active: ChaoxingActive, method: SignMethod, ok: boolean, detail: string): SignRecord {
  return {
    id: `${active.id}-${Date.now()}`,
    activeId: active.id,
    courseName: active.courseName,
    title: active.title,
    method,
    ok,
    detail,
    at: Date.now(),
  };
}

function pickArray(json: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = json[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      for (const inner of ['list', 'data', 'activeList']) {
        if (Array.isArray(nested[inner])) return nested[inner] as unknown[];
      }
    }
  }
  return [];
}

export function isSignActive(active: ChaoxingActive): boolean {
  return ACTIVE_TYPE_SIGN.has(active.activeType) && active.status === ACTIVE_STATUS_ONGOING;
}
