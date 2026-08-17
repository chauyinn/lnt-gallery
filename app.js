(() => {
  'use strict';

  const elements = {
    search: document.getElementById('searchInput'),
    themeToggle: document.getElementById('themeToggle'),
    themeIcon: document.getElementById('themeIcon'),
    seriesCount: document.getElementById('seriesCount'),
    cardCount: document.getElementById('cardCount'),
    loading: document.getElementById('loadingState'),
    empty: document.getElementById('emptyState'),
    container: document.getElementById('seriesContainer'),
    lightbox: document.getElementById('lightbox'),
    lightboxClose: document.getElementById('lightboxClose'),
    lightboxImage: document.getElementById('lightboxImg'),
    lightboxTitle: document.getElementById('lightboxTitle'),
    backToTop: document.getElementById('backToTop'),
  };

  let seriesSections = [];
  let lastLightboxTrigger = null;
  let imageObserver = null;

  function assetUrl(relativePath) {
    const normalized = String(relativePath || '').replaceAll('\\', '/');
    return `public/${normalized.split('/').map(encodeURIComponent).join('/')}`;
  }

  function preferredTheme() {
    const saved = localStorage.getItem('lnt-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('lnt-theme', theme);
    const dark = theme === 'dark';
    elements.themeIcon.textContent = dark ? '☀️' : '🌙';
    elements.themeToggle.setAttribute('aria-label', dark ? '切换为亮色主题' : '切换为深色主题');
  }

  function observeImage(image, placeholder) {
    image.addEventListener('load', () => {
      image.classList.add('loaded');
      placeholder.hidden = true;
    }, { once: true });
    image.addEventListener('error', () => {
      placeholder.hidden = true;
      image.alt = `图片加载失败：${image.alt}`;
    }, { once: true });

    if (imageObserver) {
      imageObserver.observe(image);
    } else {
      image.src = image.dataset.src;
    }
  }

  function openLightbox(card, trigger) {
    lastLightboxTrigger = trigger;
    elements.lightboxImage.src = assetUrl(card.imageFile);
    elements.lightboxImage.alt = card.cardName;
    elements.lightboxTitle.textContent = card.cardName;
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
    elements.lightboxImage.src = '';
    lastLightboxTrigger?.focus();
  }

  function createCard(card) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-item';
    button.setAttribute('aria-label', `查看卡面：${card.cardName}`);

    const imageWrap = document.createElement('span');
    imageWrap.className = 'card-img-wrap';
    const placeholder = document.createElement('span');
    placeholder.className = 'img-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.dataset.src = assetUrl(card.thumbnailFile || card.imageFile);
    image.alt = card.cardName;
    image.decoding = 'async';
    imageWrap.append(placeholder, image);

    const label = document.createElement('span');
    label.className = 'card-label';
    const name = document.createElement('span');
    name.textContent = card.cardName;
    name.title = card.cardName;
    label.append(name);

    button.append(imageWrap, label);
    button.addEventListener('click', () => openLightbox(card, button));
    observeImage(image, placeholder);
    return button;
  }

  function createSeriesSection(series) {
    const section = document.createElement('section');
    section.className = 'series-section';
    section.dataset.searchName = series.seriesName.toLocaleLowerCase('zh-CN');

    const header = document.createElement('header');
    header.className = 'series-header';
    const title = document.createElement('h2');
    title.className = 'series-title';
    title.textContent = series.seriesName;
    const count = document.createElement('span');
    count.className = 'series-count';
    count.textContent = `${series.cards.length} 张`;
    header.append(title, count);

    if (series.brand) {
      const brand = document.createElement('span');
      brand.className = 'series-brand';
      brand.textContent = series.brand;
      header.append(brand);
    }

    const grid = document.createElement('div');
    grid.className = 'series-grid';
    for (const card of series.cards) grid.append(createCard(card));
    section.append(header, grid);
    return section;
  }

  function renderGallery(data) {
    const series = Array.isArray(data.series) ? data.series : [];
    const fragment = document.createDocumentFragment();
    seriesSections = series.map((item) => {
      const section = createSeriesSection(item);
      fragment.append(section);
      return section;
    });

    elements.container.replaceChildren(fragment);
    elements.seriesCount.textContent = String(series.length);
    elements.cardCount.textContent = String(
      series.reduce((total, item) => total + item.cards.length, 0),
    );
    elements.loading.hidden = true;
    elements.container.hidden = series.length === 0;
    elements.empty.hidden = series.length !== 0;
  }

  function filterSeries() {
    const query = elements.search.value.trim().toLocaleLowerCase('zh-CN');
    let visible = 0;
    for (const section of seriesSections) {
      const matches = !query || section.dataset.searchName.includes(query);
      section.classList.toggle('search-hidden', !matches);
      section.classList.toggle('search-highlight', Boolean(query && matches));
      if (matches) visible += 1;
    }
    elements.empty.hidden = visible !== 0;
  }

  function bindEvents() {
    elements.search.addEventListener('input', filterSeries);
    elements.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
    elements.lightboxClose.addEventListener('click', closeLightbox);
    elements.lightbox.addEventListener('click', (event) => {
      if (event.target === elements.lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeLightbox();
    });
    window.addEventListener('scroll', () => {
      elements.backToTop.classList.toggle('visible', window.scrollY > 600);
    }, { passive: true });
    elements.backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function init() {
    applyTheme(preferredTheme());
    bindEvents();
    imageObserver = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const image = entry.target;
          image.src = image.dataset.src;
          observer.unobserve(image);
        }
      }, { rootMargin: '320px 0px' })
      : null;

    try {
      const response = await fetch('public/data.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderGallery(await response.json());
    } catch (error) {
      console.error('Failed to load gallery data', error);
      elements.loading.hidden = true;
      elements.container.hidden = true;
      elements.empty.hidden = false;
      elements.empty.firstElementChild.textContent = '卡面数据加载失败';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
