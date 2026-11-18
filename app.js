(() => {
  'use strict';

  const elements = {
    search: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    seriesCount: document.getElementById('seriesCount'),
    cardCount: document.getElementById('cardCount'),
    filterBar: document.getElementById('filterBar'),
    filterButtons: Array.from(document.querySelectorAll('.filter-pill')),
    countAll: document.getElementById('countAll'),
    countActive: document.getElementById('countActive'),
    countDeprecated: document.getElementById('countDeprecated'),
    archiveNote: document.getElementById('archiveNote'),
    loading: document.getElementById('loadingState'),
    empty: document.getElementById('emptyState'),
    container: document.getElementById('seriesContainer'),
    lightbox: document.getElementById('lightbox'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxBadge: document.getElementById('lightboxBadge'),
    lightboxTitle: document.getElementById('lightboxTitle'),
    lightboxSub: document.getElementById('lightboxSub'),
    backToTop: document.getElementById('backToTop'),
  };

  let allSeries = [];
  let seriesSections = [];
  let currentFilter = 'all';
  let lastTriggerElement = null;
  let imageObserver = null;

  function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return String(isoString).slice(0, 10);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function createDeprecatedBadge(extraClass = '') {
    const badge = document.createElement('span');
    badge.className = extraClass
      ? `status-badge status-badge--deprecated ${extraClass}`
      : 'status-badge status-badge--deprecated';
    badge.textContent = '已下架';
    return badge;
  }

  function assetUrl(relativePath) {
    if (!relativePath) return '';
    const normalized = String(relativePath).replaceAll('\\', '/');
    return `public/${normalized.split('/').map(encodeURIComponent).join('/')}`;
  }

  function observeImage(img) {
    img.addEventListener('load', () => {
      img.classList.add('loaded');
    }, { once: true });

    img.addEventListener('error', () => {
      img.alt = `图片加载失败：${img.alt}`;
    }, { once: true });

    if (imageObserver) {
      imageObserver.observe(img);
    } else {
      img.src = img.dataset.src;
    }
  }

  function openLightbox(card, series, trigger) {
    lastTriggerElement = trigger;
    const isDeprecated = Boolean(card.deprecated || series.deprecated);
    const deprecatedDate = formatDate(card.deprecatedAt || series.deprecatedAt);

    elements.lightboxImg.src = assetUrl(card.imageFile);
    elements.lightboxImg.alt = card.cardName;
    elements.lightboxBadge.hidden = !isDeprecated;
    elements.lightboxTitle.textContent = card.cardName;
    elements.lightboxSub.textContent = isDeprecated && deprecatedDate
      ? `${series.seriesName} · 下架归档于 ${deprecatedDate}`
      : series.seriesName;
    elements.lightbox.classList.add('active');
    elements.lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    elements.lightboxClose.focus();
  }

  function closeLightbox() {
    if (!elements.lightbox.classList.contains('active')) return;
    elements.lightbox.classList.remove('active');
    elements.lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    elements.lightboxImg.src = '';
    lastTriggerElement?.focus();
  }

  function createCard(card, series) {
    const isDeprecated = Boolean(card.deprecated || series.deprecated);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = isDeprecated ? 'card-item is-deprecated' : 'card-item';
    button.setAttribute(
      'aria-label',
      isDeprecated ? `查看卡面（已下架）：${card.cardName}` : `查看卡面：${card.cardName}`,
    );

    const imgWrap = document.createElement('div');
    imgWrap.className = 'card-img-wrap';

    const img = document.createElement('img');
    img.dataset.src = assetUrl(card.thumbnailFile || card.imageFile);
    img.alt = card.cardName;
    img.decoding = 'async';
    img.loading = 'lazy';
    imgWrap.append(img);

    const label = document.createElement('div');
    label.className = 'card-label';

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = card.cardName;
    name.title = card.cardName;
    label.append(name);

    if (isDeprecated) {
      label.append(createDeprecatedBadge('card-status-badge'));
    }

    button.append(imgWrap, label);
    button.addEventListener('click', () => openLightbox(card, series, button));
    observeImage(img);

    return {
      element: button,
      isDeprecated,
      nameLower: card.cardName.toLocaleLowerCase('zh-CN'),
    };
  }

  function createSeriesSection(series) {
    const isSeriesDeprecated = Boolean(series.deprecated);
    const section = document.createElement('section');
    section.className = isSeriesDeprecated ? 'series-section is-deprecated' : 'series-section';

    const header = document.createElement('header');
    header.className = 'series-header';

    const title = document.createElement('h2');
    title.className = 'series-title';
    title.textContent = series.seriesName;

    const count = document.createElement('span');
    count.className = 'series-count';
    count.textContent = `${series.cards.length} 张`;

    header.append(title, count);

    if (isSeriesDeprecated) {
      header.append(createDeprecatedBadge());
      const deprecatedDate = formatDate(series.deprecatedAt);
      if (deprecatedDate) {
        const dateNote = document.createElement('span');
        dateNote.className = 'series-deprecated-date';
        dateNote.textContent = `归档下架：${deprecatedDate}`;
        header.append(dateNote);
      }
    }

    const grid = document.createElement('div');
    grid.className = 'series-grid';

    const cardEntries = series.cards.map((card) => {
      const entry = createCard(card, series);
      grid.append(entry.element);
      return entry;
    });

    section.append(header, grid);
    return {
      element: section,
      countElement: count,
      seriesName: series.seriesName.toLocaleLowerCase('zh-CN'),
      cards: cardEntries,
    };
  }

  function renderGallery(data) {
    allSeries = Array.isArray(data.series) ? data.series : [];
    const fragment = document.createDocumentFragment();

    let totalCards = 0;
    let deprecatedCards = 0;
    let deprecatedSeries = 0;
    seriesSections = allSeries.map((series) => {
      const entry = createSeriesSection(series);
      fragment.append(entry.element);
      totalCards += entry.cards.length;
      if (series.deprecated) deprecatedSeries += 1;
      deprecatedCards += entry.cards.filter((c) => c.isDeprecated).length;
      return entry;
    });

    elements.container.replaceChildren(fragment);
    elements.countAll.textContent = String(totalCards);
    elements.countActive.textContent = String(totalCards - deprecatedCards);
    elements.countDeprecated.textContent = String(deprecatedCards);

    const syncDate = formatDate(data.generatedAt);
    const noteParts = [];
    if (deprecatedCards > 0) {
      noteParts.push(`已保留 ${deprecatedSeries} 个已下架系列（${deprecatedCards} 张卡面）`);
    } else {
      noteParts.push('当前暂无已下架卡面');
    }
    if (syncDate) {
      noteParts.push(`同步于 ${syncDate}`);
    }
    elements.archiveNote.textContent = noteParts.join(' · ');

    elements.loading.hidden = true;
    elements.filterBar.hidden = allSeries.length === 0;
    filterGallery();
  }

  function setStatusFilter(filter) {
    currentFilter = filter;
    for (const btn of elements.filterButtons) {
      const isSelected = btn.dataset.filter === filter;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-selected', String(isSelected));
    }
    filterGallery();
  }

  function filterGallery() {
    const query = elements.search.value.trim().toLocaleLowerCase('zh-CN');
    elements.searchClear.hidden = !query;

    let visibleSeriesCount = 0;
    let visibleCardCount = 0;

    for (const item of seriesSections) {
      const eligibleCards = [];
      for (const card of item.cards) {
        const matchesStatus =
          currentFilter === 'all'
          || (currentFilter === 'active' && !card.isDeprecated)
          || (currentFilter === 'deprecated' && card.isDeprecated);
        card.element.hidden = !matchesStatus;
        if (matchesStatus) eligibleCards.push(card);
      }

      const matchSeries = item.seriesName.includes(query);
      const matchCards = !matchSeries && eligibleCards.some((card) => card.nameLower.includes(query));
      const isVisible = eligibleCards.length > 0 && (!query || matchSeries || matchCards);

      item.element.hidden = !isVisible;
      item.countElement.textContent = `${eligibleCards.length} 张`;
      if (isVisible) {
        visibleSeriesCount += 1;
        visibleCardCount += eligibleCards.length;
      }
    }

    elements.seriesCount.textContent = String(visibleSeriesCount);
    elements.cardCount.textContent = String(visibleCardCount);
    elements.empty.firstElementChild.textContent = !query && currentFilter === 'deprecated'
      ? '暂无已下架卡面'
      : '未找到匹配的卡面或系列';
    elements.empty.hidden = visibleSeriesCount !== 0;
    elements.container.hidden = visibleSeriesCount === 0;
  }

  function bindEvents() {
    elements.search.addEventListener('input', filterGallery);

    for (const btn of elements.filterButtons) {
      btn.addEventListener('click', () => {
        setStatusFilter(btn.dataset.filter || 'all');
      });
    }

    elements.searchClear.addEventListener('click', () => {
      elements.search.value = '';
      elements.searchClear.hidden = true;
      elements.search.focus();
      filterGallery();
    });

    elements.lightboxClose.addEventListener('click', closeLightbox);
    elements.lightbox.addEventListener('click', (e) => {
      if (e.target === elements.lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox();
    });

    window.addEventListener('scroll', () => {
      elements.backToTop.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });

    elements.backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function init() {
    bindEvents();

    imageObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target;
          img.src = img.dataset.src;
          observer.unobserve(img);
        }
      }, { rootMargin: '300px 0px' })
      : null;

    try {
      const response = await fetch('public/data.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderGallery(data);
    } catch (error) {
      console.error('Failed to load gallery data', error);
      elements.loading.hidden = true;
      elements.container.hidden = true;
      elements.empty.hidden = false;
      elements.empty.firstElementChild.textContent = '卡面数据加载失败，请检查本地服务器是否正常运行';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
