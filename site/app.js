/* Knowledge Catalog × Gemini Enterprise 핸즈온 뷰어
 * guide.md 하나를 단일 원본으로 읽어 단계별 페이지로 나눠 보여줍니다. */
(() => {
  const STORAGE_KEY = 'kc-handson-done-v1';
  const CONSOLE = 'https://console.cloud.google.com';

  // 단계 번호별 콘솔 바로가기
  const CONSOLE_LINKS = {
    '0': [['Cloud Shell 열기', 'https://shell.cloud.google.com/?show=terminal']],
    '1': [['BigQuery Studio 열기', `${CONSOLE}/bigquery`]],
    '2': [['비즈니스 용어집 열기', `${CONSOLE}/dataplex/glossaries`]],
    '2-1': [['관점 유형 열기', `${CONSOLE}/dataplex/catalog/aspect-types`]],
    '2-2': [['비즈니스 용어집 열기', `${CONSOLE}/dataplex/glossaries`]],
    '2-3': [['비즈니스 용어집 열기', `${CONSOLE}/dataplex/glossaries`], ['Knowledge Catalog 검색 열기', `${CONSOLE}/dataplex/search`]],
    '3-1': [['Gemini Enterprise 열기', `${CONSOLE}/gemini-enterprise`]],
    '3-2': [['Gemini Enterprise 열기', `${CONSOLE}/gemini-enterprise`]],
    '3-3': [['Gemini Enterprise 열기', `${CONSOLE}/gemini-enterprise`]],
    '5': [['BigQuery Studio 열기', `${CONSOLE}/bigquery`], ['비즈니스 용어집 열기', `${CONSOLE}/dataplex/glossaries`]],
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    toc: $('toc'), page: $('page'), prev: $('prevBtn'), next: $('nextBtn'), done: $('doneBtn'),
    fill: $('progressFill'), ptext: $('progressText'), sidebar: $('sidebar'), scrim: $('scrim'),
    menu: $('menuBtn'), reset: $('resetBtn'), lightbox: $('lightbox'), lightboxImg: $('lightboxImg'), toast: $('toast'),
    pager: $('pager'),
  };

  let pages = [];
  let current = 0;
  let done = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));

  // ---------- Markdown → 페이지 분할 ----------
  function splitGuide(md) {
    const lines = md.split('\n');
    let inFence = false;
    let title = '';
    const intro = [];
    const sections = [];
    let sec = null;
    let sub = null;

    for (const line of lines) {
      if (/^```/.test(line)) inFence = !inFence;
      if (!inFence && /^# /.test(line) && !title) { title = line.slice(2).trim(); continue; }
      if (!inFence && /^## /.test(line)) {
        sec = { title: line.slice(3).trim(), body: [], subs: [] };
        sections.push(sec); sub = null; continue;
      }
      if (!inFence && /^### /.test(line) && sec) {
        sub = { title: line.slice(4).trim(), body: [] };
        sec.subs.push(sub); continue;
      }
      if (sub) sub.body.push(line);
      else if (sec) sec.body.push(line);
      else intro.push(line);
    }

    const clean = (arr) => arr.join('\n').replace(/^\s*---\s*$/gm, '').trim();
    const out = [{ id: 'intro', kind: 'intro', title: '실습 소개', group: null, md: clean(intro), docTitle: title }];

    sections.forEach((s) => {
      const num = (s.title.match(/^(\d+)\./) || [])[1] || '';
      const preamble = clean(s.body);
      if (!s.subs.length) {
        out.push({ id: `s${num}`, kind: 'page', title: s.title, group: null, num, md: preamble, heading: s.title });
        return;
      }
      if (preamble) {
        out.push({ id: `s${num}`, kind: 'page', title: '개요', group: s.title, num, md: preamble, heading: s.title });
      }
      s.subs.forEach((u, i) => {
        const subNum = (u.title.match(/^(\d+-\d+)\./) || [])[1] || `${num}-${i + 1}`;
        const label = u.title.replace(/^\d+-\d+\.\s*/, '');
        out.push({ id: `s${subNum}`, kind: 'page', title: label, group: s.title, num: subNum, md: clean(u.body), heading: u.title, eyebrow: s.title });
      });
    });
    return out;
  }

  // CommonMark는 `)**에서`처럼 닫는 ** 뒤에 한글이 붙으면 굵게 처리를 하지 않으므로 미리 <strong>으로 바꿉니다.
  function md2html(src) {
    const parts = src.split(/(```[\s\S]*?```)/g);
    const fixed = parts.map((part, i) => (i % 2 ? part : part.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>'))).join('');
    return marked.parse(fixed);
  }

  // ---------- 렌더링 ----------
  function renderIntro(p) {
    const firstPara = p.md.split(/\n\s*\n/)[0] || '';
    const stepCount = pages.filter((x) => x.kind === 'page').length;
    return `
      <div class="eyebrow">HANDS-ON LAB</div>
      <h1>${escapeHtml(p.docTitle)}</h1>
      ${md2html(firstPara)}
      <div class="hero-flow">
        <div class="flow-card"><div class="num">STEP 1</div><div class="ttl">BigQuery</div><div class="desc">서울 리전에 상품·주문 테이블 2개 생성</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-card"><div class="num">STEP 2</div><div class="ttl">Knowledge Catalog</div><div class="desc">용어집 · 카테고리 · 용어(NRR, COZY-EDIT) 등록</div></div>
        <div class="flow-arrow">→</div>
        <div class="flow-card"><div class="num">STEP 3–4</div><div class="ttl">Gemini Enterprise</div><div class="desc">같은 데이터에 앱 2개를 붙여 답변 비교</div></div>
      </div>
      <h3>같은 질문, 다른 답</h3>
      <p>"우리 쇼핑몰의 전체 실현 순매출 합계를 알려줘"라고 물었을 때 결과입니다.</p>
      <div class="compare">
        <div class="compare-card bad"><div class="lbl">Knowledge Catalog 꺼짐</div><div class="big">$2,450</div><div class="sub">취소·반품까지 더한 오답 [약 338만 원]</div></div>
        <div class="compare-card good"><div class="lbl">Knowledge Catalog 켜짐</div><div class="big">$2,000</div><div class="sub">용어 정의대로 취소·반품 제외 [약 276만 원]</div></div>
      </div>
      <div class="meta-row"><span>⏱ 약 40분</span><span>🧩 ${stepCount}단계</span><span>📍 asia-northeast3 (서울)</span></div>
      <button class="start-btn" data-go="1">실습 시작하기 →</button>`;
  }

  function renderPage(p) {
    const links = CONSOLE_LINKS[p.num] || [];
    const linkHtml = links.length
      ? `<div class="console-links">${links.map(([t, u]) => `<a class="console-link" href="${u}" target="_blank" rel="noopener">↗ ${t}</a>`).join('')}</div>`
      : '';
    const eyebrow = p.eyebrow ? `<div class="eyebrow">${escapeHtml(p.eyebrow)}</div>` : '';
    return `${eyebrow}<h2>${escapeHtml(p.heading)}</h2>${linkHtml}${md2html(p.md)}`;
  }

  function enhance(root) {
    // GitHub 스타일 알림 블록 변환
    root.querySelectorAll('blockquote').forEach((bq) => {
      const first = bq.querySelector('p');
      if (!first) return;
      const m = first.innerHTML.match(/^\s*\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]\s*(<br>)?/i);
      if (!m) return;
      const type = m[1].toLowerCase();
      first.innerHTML = first.innerHTML.replace(m[0], '');
      const box = document.createElement('div');
      box.className = `callout ${type}`;
      const label = { tip: '💡 팁', note: 'ℹ️ 참고', important: '❗ 중요', warning: '⚠️ 주의', caution: '⚠️ 주의' }[type];
      box.innerHTML = `<div class="callout-title">${label}</div>${bq.innerHTML}`;
      bq.replaceWith(box);
    });

    // 코드 블록 복사 버튼
    root.querySelectorAll('pre').forEach((pre) => {
      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '복사';
      btn.addEventListener('click', () => {
        copy(pre.innerText.replace(/\n$/, ''));
        btn.textContent = '✓ 복사됨'; btn.classList.add('ok');
        setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('ok'); }, 1600);
      });
      wrap.appendChild(btn);
    });

    // 인라인 코드 클릭 복사
    root.querySelectorAll(':not(pre) > code').forEach((c) => {
      c.classList.add('copyable');
      c.title = '클릭해서 복사';
      c.addEventListener('click', () => copy(c.innerText));
    });

    // 이미지 확대 + 링크 새 탭
    root.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.addEventListener('click', () => { els.lightboxImg.src = img.src; els.lightbox.classList.add('open'); });
    });
    root.querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });

    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.go)));
  }

  function renderToc() {
    let html = '';
    let lastGroup = undefined;
    pages.forEach((p, i) => {
      if (p.group !== lastGroup) {
        if (lastGroup !== undefined) html += '</ol></li>';
        html += `<li class="toc-group">${p.group ? `<div class="toc-group-title">${escapeHtml(shortLabel(p.group))}</div>` : ''}<ol class="toc">`;
        lastGroup = p.group;
      }
      const label = shortLabel(p.title);
      const cls = [i === current ? 'active' : '', done.has(p.id) ? 'done' : ''].join(' ');
      html += `<li><a href="#${p.id}" class="${cls}" data-idx="${i}"><span class="dot"></span><span>${escapeHtml(label)}</span></a></li>`;
    });
    html += '</ol></li>';
    els.toc.innerHTML = html;
  }

  function renderProgress() {
    const steps = pages.filter((p) => p.kind === 'page');
    const n = steps.filter((p) => done.has(p.id)).length;
    els.fill.style.width = `${steps.length ? (n / steps.length) * 100 : 0}%`;
    els.ptext.textContent = `${n} / ${steps.length} 완료`;
  }

  function show(i) {
    current = Math.max(0, Math.min(pages.length - 1, i));
    const p = pages[current];
    els.page.innerHTML = p.kind === 'intro' ? renderIntro(p) : renderPage(p);
    enhance(els.page);
    els.prev.disabled = current === 0;
    els.next.disabled = current === pages.length - 1;
    els.next.textContent = current === pages.length - 1 ? '마지막 단계' : '다음 →';
    els.done.style.visibility = p.kind === 'intro' ? 'hidden' : 'visible';
    updateDoneBtn();
    renderToc();
    renderProgress();
    document.title = `${p.kind === 'intro' ? '' : p.title + ' · '}Knowledge Catalog 핸즈온`;
    window.scrollTo({ top: 0 });
    closeMenu();
  }

  function updateDoneBtn() {
    const p = pages[current];
    const isDone = done.has(p.id);
    els.done.classList.toggle('done', isDone);
    els.done.textContent = isDone ? '✓ 완료됨' : '✓ 이 단계 완료';
  }

  function go(i) { location.hash = pages[Math.max(0, Math.min(pages.length - 1, i))].id; }
  function fromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const idx = pages.findIndex((p) => p.id === id);
    show(idx >= 0 ? idx : 0);
  }

  // ---------- 유틸 ----------
  function copy(text) {
    const done_ = () => toast('복사했습니다');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done_);
    else {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); done_();
    }
  }
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1300);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/`([^`]+)`/g, '<code>$1</code>'); }
  function shortLabel(t) { return t.replace(/\s*\(`[^`]+`\)\s*$/, '').trim(); }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify([...done])); }
  function closeMenu() { els.sidebar.classList.remove('open'); els.scrim.classList.remove('open'); }

  // ---------- 이벤트 ----------
  els.prev.addEventListener('click', () => go(current - 1));
  els.next.addEventListener('click', () => go(current + 1));
  els.done.addEventListener('click', () => {
    const p = pages[current];
    if (done.has(p.id)) done.delete(p.id);
    else { done.add(p.id); toast('완료로 표시했습니다'); }
    save(); updateDoneBtn(); renderToc(); renderProgress();
  });
  els.reset.addEventListener('click', () => {
    if (!confirm('완료 표시를 모두 지울까요?')) return;
    done = new Set(); save(); renderToc(); renderProgress(); updateDoneBtn();
  });
  els.menu.addEventListener('click', () => { els.sidebar.classList.toggle('open'); els.scrim.classList.toggle('open'); });
  els.scrim.addEventListener('click', closeMenu);
  els.lightbox.addEventListener('click', () => els.lightbox.classList.remove('open'));
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'Escape') els.lightbox.classList.remove('open');
    if (els.lightbox.classList.contains('open')) return;
    if (e.key === 'ArrowRight') go(current + 1);
    if (e.key === 'ArrowLeft') go(current - 1);
  });
  window.addEventListener('hashchange', fromHash);

  // ---------- 시작 ----------
  fetch('guide.md', { cache: 'no-cache' })
    .then((r) => r.text())
    .then((md) => { pages = splitGuide(md); fromHash(); })
    .catch(() => { els.page.innerHTML = '<p>가이드를 불러오지 못했습니다. 새로고침해 주세요.</p>'; });
})();
