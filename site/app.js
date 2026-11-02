/* CourseDesk 介绍页：一屏一页的幻灯片分页（淡出→淡入）、界面截图切换、复制命令。没有依赖。 */
(() => {
  'use strict';

  /* ---------------------------------------------------------------- 截图页 */
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

  /* 切图：截图先淡出，换页后再淡入 */
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
    }, 300);
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

  /* ---------------------------------------------------------------- 分页 */
  const deck = document.getElementById('main');
  const slides = deck ? Array.from(deck.querySelectorAll('.slide')) : [];
  const dots = document.querySelector('.deck-dots');
  const countEl = document.querySelector('.deck-count');
  let current = 0;
  let busy = false;
  let dotEls = [];

  if (slides.length) {
    /* 顶栏高度 → deck 的起点（小屏时顶栏会折成两行） */
    const syncBar = () => {
      const bar = document.querySelector('.topbar');
      if (bar) document.documentElement.style.setProperty('--bar', `${bar.offsetHeight}px`);
    };
    syncBar();
    window.addEventListener('resize', syncBar);

    if (dots) {
      dotEls = slides.map((slide, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', slide.dataset.label || slide.id || `第 ${i + 1} 页`);
        const tip = document.createElement('span');
        tip.textContent = slide.dataset.label || String(i + 1).padStart(2, '0');
        b.appendChild(tip);
        b.addEventListener('click', () => go(i));
        dots.appendChild(b);
        return b;
      });
    }

    const innerOf = (i) => slides[i].querySelector(':scope > .wrap');

    function render(i) {
      slides.forEach((slide, idx) => {
        const on = idx === i;
        slide.classList.toggle('is-active', on);
        slide.setAttribute('aria-hidden', on ? 'false' : 'true');
        if ('inert' in slide) slide.inert = !on;
      });
      dotEls.forEach((d, idx) => d.classList.toggle('is-active', idx === i));
      deck.classList.toggle('is-cover', i === 0);
      if (countEl) countEl.textContent = `${String(i + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
      document.querySelectorAll('.nav a').forEach((a) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        a.classList.toggle('is-active', Boolean(target) && target.closest('.slide') === slides[i]);
      });
      if (history.replaceState) history.replaceState(null, '', i === 0 ? location.pathname : `#${slides[i].id}`);
    }

    function go(i) {
      const next = Math.max(0, Math.min(slides.length - 1, i));
      if (next === current || busy) return;
      const from = slides[current];
      busy = true;
      // 旧页先走，180ms 后新页跟着进——两段淡出淡入叠一点，中间不留空帧
      from.classList.add('is-leaving');
      from.classList.remove('is-active');
      window.setTimeout(() => {
        current = next;
        render(next);
        innerOf(next)?.scrollTo(0, 0);
      }, 200);
      window.setTimeout(() => {
        from.classList.remove('is-leaving');
        busy = false;
      }, 760);
    }

    /* 初始页：看 hash 指向哪一页 */
    const fromHash = location.hash.replace('#', '');
    const index = slides.findIndex((s) => s.id === fromHash || Boolean(fromHash && s.contains(document.getElementById(fromHash))));
    current = index > 0 ? index : 0;
    render(current);

    /* 滚轮：先让页内滚动，到边界再翻页 */
    let lock = 0;
    window.addEventListener(
      'wheel',
      (e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        const inner = innerOf(current);
        if (inner && inner.scrollHeight > inner.clientHeight + 2) {
          const atTop = inner.scrollTop <= 0;
          const atEnd = inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 2;
          if ((e.deltaY > 0 && !atEnd) || (e.deltaY < 0 && !atTop)) return; // 交给页内滚动
        }
        e.preventDefault();
        const now = Date.now();
        if (now < lock || Math.abs(e.deltaY) < 8) return;
        lock = now + 780;
        go(current + (e.deltaY > 0 ? 1 : -1));
      },
      { passive: false },
    );

    /* 键盘 */
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('input, textarea, select, summary, button, a')) return;
      const down = e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Spacebar';
      const up = e.key === 'ArrowUp' || e.key === 'PageUp';
      const home = e.key === 'Home';
      const end = e.key === 'End';
      if (!down && !up && !home && !end) return;
      e.preventDefault();
      if (home) go(0);
      else if (end) go(slides.length - 1);
      else go(current + (down ? 1 : -1));
    });

    /* 触屏上下滑 */
    let touchY = 0;
    let touchX = 0;
    window.addEventListener(
      'touchstart',
      (e) => {
        touchY = e.touches[0].clientY;
        touchX = e.touches[0].clientX;
      },
      { passive: true },
    );
    window.addEventListener(
      'touchend',
      (e) => {
        const dy = e.changedTouches[0].clientY - touchY;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dy) <= 56 || Math.abs(dy) <= Math.abs(dx)) return;
        // 页内还能滚就交给页内滚动，滚到边界才翻页
        const inner = innerOf(current);
        if (inner && inner.scrollHeight > inner.clientHeight + 2) {
          const atTop = inner.scrollTop <= 0;
          const atEnd = inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 2;
          if ((dy < 0 && !atEnd) || (dy > 0 && !atTop)) return;
        }
        go(current + (dy < 0 ? 1 : -1));
      },
      { passive: true },
    );

    /* 站内锚点都变成翻页 */
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const target = document.getElementById(a.getAttribute('href').slice(1));
      const slide = target && target.closest('.slide');
      if (!slide) return;
      e.preventDefault();
      go(slides.indexOf(slide));
    });

    window.addEventListener('hashchange', () => {
      const id = location.hash.replace('#', '');
      const i = slides.findIndex((s) => s.id === id || (id && s.contains(document.getElementById(id))));
      if (i >= 0) go(i);
    });
  }

  /* ---------------------------------------------------------------- 复制 */
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
