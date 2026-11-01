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

  function select(id, focus) {
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

  /* 滚动入场 */
  const revealTargets = [
    '.sec-head',
    '.reasons',
    '.shots',
    '.tablewrap',
    '.pipe',
    '.dark__note',
    '.steps',
    '.code',
    '.edges',
    '.notes',
    '.qa',
    '.download',
  ];
  const targets = revealTargets.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    targets.forEach((el, i) => {
      el.classList.add('reveal');
      el.style.transitionDelay = `${Math.min(i % 4, 3) * 40}ms`;
      io.observe(el);
    });
  }

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
