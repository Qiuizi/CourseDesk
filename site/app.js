/* CourseDesk 介绍页：标签切换、入场动效、复制命令。没有依赖。 */
(() => {
  'use strict';

  const SHOTS = {
    today: {
      title: 'CourseDesk — 今天',
      flag: '普通',
      caption: '一屏看完：在课、待签到、作业、时间线与快捷操作。相邻的同类事件会折叠成 ×N。',
    },
    yuketang: {
      title: 'CourseDesk — 雨课堂',
      flag: '普通',
      caption: '题目可以直接点选：单选/投票/判断点选项，多选可多选，填空按空输入；主观题只出解析、不提交。',
    },
    chaoxing: {
      title: 'CourseDesk — 学习通',
      flag: '普通',
      caption: '进行中的签到、签到记录、作业与自动签到开关；二维码和拍照只提醒，不尝试识别。',
    },
    log: {
      title: 'CourseDesk — 记录',
      flag: '普通',
      caption: '两个平台一条时间线，按平台与级别筛选；轮询失败之类的重复事件会被折叠。',
    },
    settings: {
      title: 'CourseDesk — 设置',
      flag: '普通',
      caption: '接口变更提醒放在最上面：每个探测项的字段数、基线与「立即检测」。',
    },
    dev: {
      title: 'CourseDesk — 总览',
      flag: '开发者',
      caption: '开发者模式：协议结构指纹、基线差异、未识别 WS 消息与主进程日志。',
    },
  };

  const tabs = Array.from(document.querySelectorAll('.tab[data-shot]'));
  const panels = new Map(
    tabs.map((t) => [t.dataset.shot, document.getElementById(`shot-${t.dataset.shot}`)]),
  );
  const titleEl = document.getElementById('frame-title');
  const captionEl = document.getElementById('shot-caption');
  const flagEl = document.querySelector('.frame__flag');

  const stage = document.querySelector('.frame__stage');
  let swapTimer = 0;

  function apply(id, focus) {
    const meta = SHOTS[id];
    if (!meta) return;
    tabs.forEach((tab) => {
      const on = tab.dataset.shot === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    panels.forEach((panel, key) => {
      if (!panel) return;
      const on = key === id;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
    });
    if (titleEl) titleEl.textContent = meta.title;
    if (captionEl) captionEl.textContent = meta.caption;
    if (flagEl) flagEl.textContent = meta.flag;
  }

  /* 切页：先让截图淡出，换页后再淡入；减少动效时直接切换 */
  function select(id, focus) {
    const active = tabs.find((tab) => tab.classList.contains('is-active'));
    if (!SHOTS[id] || (active && active.dataset.shot === id)) return;
    if (!stage) {
      apply(id, focus);
      return;
    }
    clearTimeout(swapTimer);
    stage.classList.add('is-swapping');
    swapTimer = window.setTimeout(() => {
      apply(id, focus);
      requestAnimationFrame(() => stage.classList.remove('is-swapping'));
    }, 160);
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => select(tab.dataset.shot)));

  const list = document.querySelector('.shots__tabs');
  if (list) {
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        select(tabs[next].dataset.shot, true);
      }
    });
  }

  /* 渐进消失：以「页」为单位，滚动时按离视口的距离整页渐隐（只写一个 --p） */
  const fadeTargets = Array.from(
    document.querySelectorAll('main .hero > .wrap, main .section > .wrap, main .dark > .wrap, footer > .wrap'),
  );

  function initFade() {
    const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
    const smooth = (n) => n * n * (3 - 2 * n);
    let frame = 0;

    fadeTargets.forEach((el) => el.setAttribute('data-fading', ''));

    const paint = () => {
      frame = 0;
      const vh = window.innerHeight || 1;
      // 进入 / 离开各留 30% 视口做过渡，整页一起渐隐，而不是各块错位
      const inBand = vh * 0.3;
      const outBand = vh * 0.32;
      // 滚到底以后，最后的内容没机会再往上走，别让它永远停在半透明
      const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      for (const el of fadeTargets) {
        const r = el.getBoundingClientRect();
        const enter = atBottom && r.bottom <= vh ? 1 : clamp01((vh - r.top) / inBand);
        const leave = clamp01(r.bottom / outBand);
        const p = smooth(Math.min(enter, leave));
        el.style.setProperty('--p', p.toFixed(3));
        el.toggleAttribute('data-faded', p < 0.02);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('load', schedule, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    paint();
  }

  initFade();

  /* 复制命令 */
  document.querySelectorAll('.copy[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const src = document.querySelector(btn.dataset.copy);
      if (!src) return;
      const text = src.innerText.replace(/\s+$/g, '');
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = old), 1600);
      } catch {
        btn.textContent = '手动复制';
      }
    });
  });
})();
