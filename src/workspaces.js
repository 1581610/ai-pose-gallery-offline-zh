/* Navigation stays hash-based so both file URLs and repository Pages work. */
(() => {
  'use strict';
  const pages = new Set(['poses', 'costumes', 'portraits', 'studio', 'settings']);
  const app = document.getElementById('app');
  const poseWorkspace = document.getElementById('poseWorkspace');
  const navigation = document.getElementById('referenceNav');
  const scrollPositions = new Map();
  let currentPage = '';

  function setPage(page, updateHash = true) {
    if (!pages.has(page)) page = 'poses';
    const changed = currentPage !== page;
    if (page !== 'poses') {
      ['viewer', 'boardDialog', 'smallDialog'].forEach(id => {
        const dialog = document.getElementById(id);
        if (dialog?.open) dialog.close();
      });
    }
    if (changed && currentPage) scrollPositions.set(currentPage, window.scrollY);
    app.dataset.workspace = page;
    poseWorkspace.hidden = page !== 'poses';
    navigation.querySelectorAll('[data-workspace]').forEach(button => {
      const active = button.dataset.workspace === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (updateHash && location.hash !== '#' + page) history.pushState(null, '', '#' + page);
    document.dispatchEvent(new CustomEvent('pose-workspace-change', {detail: {page}}));
    if (changed && currentPage) window.scrollTo(0, scrollPositions.get(page) || 0);
    currentPage = page;
  }

  navigation.addEventListener('click', event => {
    const button = event.target.closest('[data-workspace]');
    if (button) setPage(button.dataset.workspace);
  });
  document.querySelectorAll('#libraryNav, #collections, #series').forEach(element => {
    element.addEventListener('click', () => setPage('poses'));
  });
  document.querySelector('.brand').addEventListener('click', event => {
    event.preventDefault();
    setPage('poses');
  });
  window.addEventListener('hashchange', () => setPage(location.hash.slice(1), false));
  document.addEventListener('pose-workspace-request', event => setPage(event.detail?.page));
  window.PoseWorkspace = Object.freeze({setPage});
  // All embedded modules register listeners before the first route is shown.
  queueMicrotask(() => setPage(location.hash.slice(1) || 'poses', false));
})();
