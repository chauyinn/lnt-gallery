(() => {
  'use strict';

  const elements = {
    search: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    seriesCount: document.getElementById('seriesCount'),
    cardCount: document.getElementById('cardCount'),
    loading: document.getElementById('loadingState'),
    empty: document.getElementById('emptyState'),
    container: document.getElementById('seriesContainer'),
    lightbox: document.getElementById('lightbox'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxTitle: document.getElementById('lightboxTitle'),
    lightboxSub: document.getElementById('lightboxSub'),
    backToTop: document.getElementById('backToTop'),
  };

  let allSeries = [];
  let seriesSections = [];
  let lastTriggerElement = null;
  let imageObserver = null;

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
    elements.lightboxImg.src = assetUrl(card.imageFile);
    elements.lightboxImg.alt = card.cardName;
    elements.lightboxTitle.textContent = card.cardName;
    elements.lightboxSub.textContent = series.seriesName;
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-item';
    button.setAttribute('aria-label', `查看卡面：${card.cardName}`);

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

    button.append(imgWrap, label);
    button.addEventListener('click', () => openLightbox(card, series, button));
    observeImage(img);

    return button;
  }

  function createSeriesSection(series) {
    const section = document.createElement('section');
    section.className = 'series-section';

    const header = document.createElement('header');
    header.className = 'series-header';

    const title = document.createElement('h2');
    title.className = 'series-title';
    title.textContent = series.seriesName;

    const count = document.createElement('span');
    count.className = 'series-count';
    count.textContent = `${series.cards.length} 张`;

    header.append(title, count);

    const grid = document.createElement('div');
    grid.className = 'series-grid';

    for (const card of series.cards) {
      grid.append(createCard(card, series));
    }

    section.append(header, grid);
    return section;
  }

  function renderGallery(data) {
    allSeries = Array.isArray(data.series) ? data.series : [];
    const fragment = document.createDocumentFragment();

    let totalCards = 0;
    seriesSections = allSeries.map((series) => {
      totalCards += series.cards.length;
      const section = createSeriesSection(series);
      fragment.append(section);
      return {
        element: section,
        seriesName: series.seriesName.toLocaleLowerCase('zh-CN'),
        cardNames: series.cards.map((c) => c.cardName.toLocaleLowerCase('zh-CN')),
      };
    });

    elements.container.replaceChildren(fragment);
    elements.seriesCount.textContent = String(allSeries.length);
    elements.cardCount.textContent = String(totalCards);

    elements.loading.hidden = true;
    elements.container.hidden = allSeries.length === 0;
    elements.empty.hidden = allSeries.length !== 0;
  }

  function filterGallery() {
    const query = elements.search.value.trim().toLocaleLowerCase('zh-CN');
    elements.searchClear.hidden = !query;

    let visibleCount = 0;

    for (const item of seriesSections) {
      const matchSeries = item.seriesName.includes(query);
      const matchCards = !matchSeries && item.cardNames.some((name) => name.includes(query));
      const isVisible = !query || matchSeries || matchCards;

      item.element.hidden = !isVisible;
      if (isVisible) visibleCount += 1;
    }

    elements.empty.hidden = visibleCount !== 0;
    elements.container.hidden = visibleCount === 0;
  }

  function bindEvents() {
    elements.search.addEventListener('input', filterGallery);

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
