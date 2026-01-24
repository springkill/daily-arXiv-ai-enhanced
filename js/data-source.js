(() => {
  if (typeof DATA_CONFIG === 'undefined') {
    return;
  }

  const STORAGE_KEY = 'arxiv_data_source';
  const UPSTREAM_SOURCE = {
    key: 'upstream',
    owner: 'dw-dengwei',
    repoName: 'daily-arXiv-ai-enhanced',
    label: 'Upstream'
  };

  const resolveLocalSource = () => {
    let owner = null;
    let repoName = null;

    if (typeof inferRepoInfo === 'function') {
      const inferred = inferRepoInfo();
      owner = inferred.owner || null;
      repoName = inferred.repoName || null;
    }

    if (!owner) {
      owner = DATA_CONFIG.repoOwner || UPSTREAM_SOURCE.owner;
    }
    if (!repoName) {
      repoName = DATA_CONFIG.repoName || UPSTREAM_SOURCE.repoName;
    }

    return {
      key: 'local',
      owner: owner,
      repoName: repoName,
      label: 'Local'
    };
  };

  const LOCAL_SOURCE = resolveLocalSource();
  const SOURCES = {
    local: LOCAL_SOURCE,
    upstream: UPSTREAM_SOURCE
  };

  const normalizeSourceKey = (value) => {
    if (!value) {
      return null;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['local', 'fork', 'mine', 'self'].includes(normalized)) {
      return 'local';
    }
    if (['upstream', 'origin', 'official', 'main'].includes(normalized)) {
      return 'upstream';
    }

    return null;
  };

  const getQuerySource = () => {
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeSourceKey(params.get('source'));
    } catch (error) {
      return null;
    }
  };

  const getStoredSource = () => {
    try {
      return normalizeSourceKey(window.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return null;
    }
  };

  const setStoredSource = (key) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch (error) {
      return;
    }
  };

  const applySource = (key) => {
    const source = SOURCES[key] || LOCAL_SOURCE;
    DATA_CONFIG.repoOwner = source.owner;
    DATA_CONFIG.repoName = source.repoName;
    DATA_CONFIG.activeSource = source.key;
    return source;
  };

  const setSourceInUrl = (key) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('source', key);
      return url.toString();
    } catch (error) {
      return window.location.href;
    }
  };

  const updateInternalLinks = (key) => {
    const links = document.querySelectorAll(
      'a[href="index.html"], a[href="statistic.html"], a[href="settings.html"]'
    );
    links.forEach((link) => {
      try {
        const url = new URL(link.getAttribute('href'), window.location.href);
        url.searchParams.set('source', key);
        link.setAttribute('href', url.pathname + url.search);
      } catch (error) {
        return;
      }
    });
  };

  const updateRepoLinks = (source) => {
    const repoUrl = `https://github.com/${source.owner}/${source.repoName}`;
    document.querySelectorAll('a.github-button').forEach((link) => {
      link.setAttribute('href', repoUrl);
    });
    document.querySelectorAll('footer a[href^="https://github.com/"]').forEach((link) => {
      link.setAttribute('href', repoUrl);
    });
  };

  const getToggleLabel = (toggle, key, fallback) => {
    if (key === 'local' && toggle.dataset.labelLocal) {
      return toggle.dataset.labelLocal;
    }
    if (key === 'upstream' && toggle.dataset.labelUpstream) {
      return toggle.dataset.labelUpstream;
    }
    return fallback;
  };

  const updateToggleUI = (toggle, key) => {
    const source = SOURCES[key] || LOCAL_SOURCE;
    const label = getToggleLabel(toggle, source.key, source.label);
    const valueEl = toggle.querySelector('.data-source-value');
    if (valueEl) {
      valueEl.textContent = label;
    } else {
      toggle.textContent = `Source: ${label}`;
    }
    toggle.dataset.source = source.key;
  };

  const initialKey = getQuerySource() || getStoredSource() || 'local';
  const activeKey = SOURCES[initialKey] ? initialKey : 'local';
  const activeSource = applySource(activeKey);

  document.addEventListener('DOMContentLoaded', () => {
    updateRepoLinks(activeSource);
    updateInternalLinks(activeKey);

    const toggle = document.getElementById('dataSourceToggle');
    if (!toggle) {
      return;
    }

    let currentKey = activeKey;
    updateToggleUI(toggle, currentKey);

    toggle.addEventListener('click', () => {
      const nextKey = currentKey === 'local' ? 'upstream' : 'local';
      setStoredSource(nextKey);
      window.location.href = setSourceInUrl(nextKey);
    });
  });
})();
