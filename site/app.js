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

  /* 滚动淡出：每一页都随滚动「溶解」——目标值由位置算出，
     显示值用阻尼跟随（lerp），所以滚轮跳一格、拖滚动条、锚点跳转都是滑过去的，不会瞬切。 */
  const fadeTargets = Array.from(
    document.querySelectorAll('main .hero > .wrap, main .section > .wrap, main .dark > .wrap, footer > .wrap'),
  );

  const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
  const smooth = (n) => n * n * (3 - 2 * n);

  function targetFor(r, vh, atBottom) {
    // 从底部升起：占视口 45% 的行程里淡入
    const enter = atBottom && r.bottom <= vh ? 1 : clamp01((vh - r.top) / (vh * 0.45));
    // 滚过自身高度 15% 后开始淡出，滚到完全离开时正好归零
    const span = Math.max(1, Math.min(r.height, vh));
    const passed = clamp01(-r.top / span);
    const out = 1 - smooth(clamp01((passed - 0.1) / 1.0));
    return smooth(Math.min(enter, out));
  }

  if (fadeTargets.length) {
    const state = fadeTargets.map((el) => {
      el.setAttribute('data-fading', '');
      return { el, v: 1 };
    });
    let raf = 0;
    let inited = false;

    const tick = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 2;
      let moving = false;

      // 先读后写：一次 rAF 内只做一轮布局读取
      const values = state.map((item) => {
        const target = targetFor(item.el.getBoundingClientRect(), vh, atBottom);
        if (!inited) {
          item.v = target;
          return target;
        }
        // 阻尼一直开：透明度不是位移，系统关掉动画时也应该滑过去
        const k = 0.18;
        item.v += (target - item.v) * k;
        if (Math.abs(target - item.v) < 0.0015) item.v = target;
        else moving = true;
        return item.v;
      });
      inited = true;

      state.forEach((item, i) => {
        const p = values[i];
        item.el.style.setProperty('--p', p.toFixed(3));
        item.el.toggleAttribute('data-faded', p < 0.02);
        // 只给正在消失的页加模糊，静止的页不创建滤镜层
        item.el.toggleAttribute('data-blur', p < 0.985 && p > 0.02);
      });

      if (moving) raf = requestAnimationFrame(tick);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick, { passive: true });
    window.addEventListener('load', kick, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
    kick();
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
