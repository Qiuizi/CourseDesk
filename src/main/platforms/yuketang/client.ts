/**
 * 雨课堂协议客户端。
 *
 * 认证三件套：
 *   1. Cookie（Electron persist 分区自动携带）
 *   2. 平台头（xtbz / X-Client / uv-id）
 *   3. Bearer token —— 任意响应的 `Set-Auth` 下发，需回写到后续请求
 *
 * 这里把 token 存在内存 + 交给上层持久化（避免重启后必须先进一次课堂）。
 */

import { request, requestWithRetry, describeHttpFailure, type HttpResult } from '../../core/net';
import { log } from '../../core/log';
import { H5_HEADERS, WEB_HEADERS, yt } from './endpoints';
import type { Course, HomeworkItem, OnLesson, Problem } from '@shared/types';
import { normalizeCourseList, normalizeProblem, num, str } from './normalize';
import type { VideoRef } from './normalize';

export interface YtEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
  success?: boolean;
  result?: unknown;
}

export class YtClient {
  bearer = '';
  uvId = '0';
  userId = '';
  universityId = '0';

  constructor(private host = 'www.yuketang.cn') {}

  setHost(host: string): void {
    if (host && host !== this.host) {
      this.host = host;
      log.info('yt', `域名切换为 ${host}`);
    }
  }

  getHost(): string {
    return this.host;
  }

  private absorbAuth(res: HttpResult): void {
    const token = res.headers['set-auth'];
    if (token) {
      this.bearer = token;
      log.debug('yt', 'Set-Auth 续期成功');
    }
  }

  private h5Headers(): Record<string, string> {
    const h: Record<string, string> = { ...H5_HEADERS };
    if (this.bearer) h.Authorization = `Bearer ${this.bearer}`;
    return h;
  }

  private webHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      ...WEB_HEADERS,
      'university-id': this.universityId,
      'uv-id': this.uvId,
    };
    if (this.bearer) h.Authorization = `Bearer ${this.bearer}`;
    return h;
  }

  /** 统一的信封解析：code===0 视为成功，旧网关用 success/result */
  private unwrap<T>(res: HttpResult): { ok: boolean; data?: T; msg: string } {
    this.absorbAuth(res);
    if (res.status === 0) return { ok: false, msg: describeHttpFailure(res) };
    const body = res.json as YtEnvelope<T> | null;
    if (!body) {
      return { ok: res.ok, msg: res.ok ? '响应非 JSON' : describeHttpFailure(res) };
    }
    if (typeof body.code === 'number') {
      return { ok: body.code === 0, data: body.data, msg: body.msg ?? (body.code === 0 ? 'ok' : `code ${body.code}`) };
    }
    if (typeof body.success === 'boolean') {
      return { ok: body.success, data: (body.data ?? body.result) as T | undefined, msg: body.success ? 'ok' : 'success=false' };
    }
    return { ok: res.ok, data: (body.data ?? body.result ?? body) as T, msg: res.ok ? 'ok' : describeHttpFailure(res) };
  }

  // ---------------------------------------------------------------- 课程

  async courses(): Promise<Course[]> {
    const res = await requestWithRetry(yt.courseList(this.host), { headers: this.webHeaders() });
    const { ok, data, msg } = this.unwrap<Record<string, unknown>>(res);
    if (!ok) {
      log.warn('yt', `课程列表失败：${msg}`, { status: res.status });
      return [];
    }
    const list = normalizeCourseList(data);
    log.info('yt', `课程列表 ${list.length} 门`);
    return list;
  }

  async onLesson(): Promise<OnLesson[]> {
    const res = await request(yt.onLesson(this.host), { headers: this.webHeaders() });
    const { ok, data, msg } = this.unwrap<{ onLessonClassrooms?: unknown[] }>(res);
    if (!ok) {
      log.debug('yt', `在课接口：${msg}`);
      return [];
    }
    const raw = Array.isArray(data?.onLessonClassrooms) ? data.onLessonClassrooms : [];
    return raw.map((item) => {
      const o = item as Record<string, unknown>;
      return {
        lessonId: str(o.lessonId ?? o.lesson_id),
        classroomId: str(o.classroomId ?? o.classroom_id),
        courseId: str(o.courseId ?? o.course_id),
        courseName: str(o.courseName ?? o.course_name) || '未命名课程',
        classroomName: str(o.classroomName ?? o.classroom_name),
        role: num(o.role, 5),
        detectedAt: Date.now(),
      } satisfies OnLesson;
    }).filter((x) => x.lessonId);
  }

  // ---------------------------------------------------------------- 课堂

  async checkin(lessonId: string, classroomId: string, source: number): Promise<{ ok: boolean; lessonToken?: string; identityId?: string; msg: string }> {
    const body = JSON.stringify({ source, lessonId, classroomId });
    const res = await request(yt.checkin(this.host), {
      method: 'POST',
      headers: {
        ...this.h5Headers(),
        'Content-Type': 'application/json; charset=utf-8',
        referer: yt.lessonPage(this.host, lessonId, source),
        origin: yt.origin(this.host),
      },
      body,
    });
    const { ok, data, msg } = this.unwrap<{ lessonToken?: string; identityId?: string | number }>(res);
    if (!ok) return { ok: false, msg };
    return {
      ok: true,
      lessonToken: str(data?.lessonToken),
      identityId: str(data?.identityId),
      msg: 'ok',
    };
  }

  /** 课件 → 题目 + 视频。presentation/fetch 是随堂题的主来源。 */
  async presentation(presentationId: string): Promise<{ problems: Problem[]; videos: VideoRef[] }> {
    const res = await request(yt.presentation(this.host, presentationId), { headers: this.h5Headers() });
    const { ok, data, msg } = this.unwrap<{ slides?: unknown[] }>(res);
    if (!ok) {
      log.warn('yt', `课件拉取失败：${msg}`);
      return { problems: [], videos: [] };
    }
    const slides = Array.isArray(data?.slides) ? data!.slides! : [];
    const problems: Problem[] = [];
    const videos: VideoRef[] = [];
    slides.forEach((slide, index) => {
      const s = slide as Record<string, unknown>;
      const p = s.problem as Record<string, unknown> | undefined;
      if (p && (p.problemId ?? p.problem_id)) {
        problems.push(normalizeProblem(p, index));
      }
      const shapes = Array.isArray(s.shapes) ? s.shapes : [];
      for (const shape of shapes) {
        const sh = shape as Record<string, unknown>;
        const playurl = str(sh.playurl ?? sh.playUrl);
        if (!playurl) continue;
        videos.push({
          presentationId,
          slideIndex: index,
          slideId: str(s.sid ?? s.id),
          videoId: str(sh.videoId ?? sh.id ?? `${presentationId}-${index}`),
          url: playurl,
          duration: num(sh.duration ?? sh.dt, 0),
          name: str(sh.name ?? sh.title),
        });
      }
    });
    log.info('yt', `课件 ${presentationId}: ${problems.length} 题 / ${videos.length} 视频`);
    return { problems, videos };
  }

  async activePresentation(lessonId: string): Promise<string> {
    const res = await request(yt.presentationActive(this.host, lessonId), { headers: this.h5Headers() });
    const { ok, data } = this.unwrap<Record<string, unknown>>(res);
    if (!ok || !data) return '';
    return str(data.presentation ?? data.presentationId ?? data.presentation_id ?? data.id);
  }

  async problemDetail(problemId: string): Promise<Problem | null> {
    const res = await request(yt.problemDetail(this.host, problemId), { headers: this.h5Headers() });
    const { ok, data } = this.unwrap<Record<string, unknown>>(res);
    if (!ok || !data) return null;
    const p = (data.problem as Record<string, unknown>) ?? data;
    return normalizeProblem(p, 0);
  }

  /** 作答提交。result 结构按题型：选择题 = 选项字母数组，填空 = 文本数组，主观 = 对象。 */
  async answer(problemId: string, problemType: number, result: unknown): Promise<{ ok: boolean; msg: string }> {
    const res = await request(yt.answer(this.host), {
      method: 'POST',
      headers: this.h5Headers(),
      body: JSON.stringify({ problemId, problemType, dt: Date.now(), result }),
    });
    const { ok, msg } = this.unwrap(res);
    if (!ok) log.warn('yt', `作答被拒绝 ${problemId}: ${msg}`);
    return { ok, msg };
  }

  async retry(problemId: string, problemType: number, result: unknown, dt: number): Promise<{ ok: boolean; msg: string }> {
    const res = await request(yt.retry(this.host), {
      method: 'POST',
      headers: this.h5Headers(),
      body: JSON.stringify({ problems: [{ problemId, problemType, dt, result }] }),
    });
    const { ok, msg } = this.unwrap(res);
    return { ok, msg };
  }

  // ---------------------------------------------------------------- 视频

  async videoHeartbeat(events: unknown[]): Promise<{ ok: boolean; msg: string }> {
    const res = await request(yt.videoHeartbeat(this.host), {
      method: 'POST',
      headers: this.h5Headers(),
      body: JSON.stringify({ heart_data: events }),
    });
    const { ok, msg } = this.unwrap(res);
    return { ok, msg };
  }

  // ---------------------------------------------------------------- 作业

  async exerciseList(leafId: string): Promise<HomeworkItem[]> {
    const res = await request(yt.exerciseList(this.host, leafId, this.uvId), { headers: this.webHeaders() });
    const { ok, data, msg } = this.unwrap<Record<string, unknown>>(res);
    if (!ok) {
      log.debug('yt', `作业列表 ${leafId}: ${msg}`);
      return [];
    }
    const list = Array.isArray(data?.exerciseList) ? data!.exerciseList! : Array.isArray(data?.list) ? data!.list! : [];
    return list.map((item) => {
      const o = item as Record<string, unknown>;
      const title = str(o.title ?? o.exerciseName ?? o.name) || `作业 ${str(o.exerciseId ?? o.id)}`;
      return {
        platform: 'yuketang' as const,
        id: str(o.exerciseId ?? o.id),
        courseName: str(o.courseName) || '雨课堂',
        title,
        statusText: str(o.statusText ?? o.status) || (num(o.submitted, 0) ? '已提交' : '未提交'),
        leftText: str(o.deadline ?? o.endTime),
        leftHours: null,
        url: `https://${this.host}/v2/web/index#/exercise`,
      } satisfies HomeworkItem;
    }).filter((x) => x.id);
  }
}


export { str, num, normalizeCourseList, normalizeProblem, inferBlankCount, buildResult } from './normalize';
export type { VideoRef } from './normalize';
