const state = {
  user: null,
  files: [],
  currentPath: null,
  currentMtimeMs: null,
  dirty: false,
  lintTimer: null,
  lintRequestId: 0,
  lintMessages: [],
  folds: []
};

const THEME_STORAGE_KEY = 'yaml-editor-theme';

const elements = {
  loginView: document.querySelector('#loginView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  username: document.querySelector('#username'),
  password: document.querySelector('#password'),
  loginError: document.querySelector('#loginError'),
  userBadge: document.querySelector('#userBadge'),
  logoutButton: document.querySelector('#logoutButton'),
  refreshFilesButton: document.querySelector('#refreshFilesButton'),
  fileSearch: document.querySelector('#fileSearch'),
  newFileForm: document.querySelector('#newFileForm'),
  newFilePath: document.querySelector('#newFilePath'),
  fileList: document.querySelector('#fileList'),
  fileListMeta: document.querySelector('#fileListMeta'),
  currentFileName: document.querySelector('#currentFileName'),
  formatButton: document.querySelector('#formatButton'),
  reloadButton: document.querySelector('#reloadButton'),
  saveButton: document.querySelector('#saveButton'),
  editor: document.querySelector('#editor'),
  lineNumbers: document.querySelector('#lineNumbers'),
  issueHighlights: document.querySelector('#issueHighlights'),
  issueHighlightList: document.querySelector('#issueHighlightList'),
  lintPanel: document.querySelector('#lintPanel'),
  lintSummary: document.querySelector('#lintSummary'),
  lintList: document.querySelector('#lintList'),
  dirtyState: document.querySelector('#dirtyState'),
  editorStats: document.querySelector('#editorStats'),
  yamlCheck: document.querySelector('#yamlCheck'),
  toast: document.querySelector('#toast'),
  themeToggles: document.querySelectorAll('[data-theme-toggle]'),
  syntaxHighlight: document.querySelector('#syntaxHighlight')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove('visible');
  }, 2400);
}

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
}

function getPreferredTheme() {
  const storedTheme = readStoredTheme();
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  for (const toggle of elements.themeToggles) {
    toggle.checked = nextTheme === 'dark';
  }
}

function initTheme() {
  applyTheme(getPreferredTheme());
  for (const toggle of elements.themeToggles) {
    toggle.addEventListener('change', () => {
      const nextTheme = toggle.checked ? 'dark' : 'light';
      writeStoredTheme(nextTheme);
      applyTheme(nextTheme);
    });
  }

  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  colorSchemeQuery.addEventListener?.('change', () => {
    if (!readStoredTheme()) {
      applyTheme(getPreferredTheme());
    }
  });
}

function showLogin() {
  elements.loginView.classList.remove('hidden');
  elements.appView.classList.add('hidden');
  elements.password.value = '';
  elements.username.focus();
}

function showApp() {
  elements.loginView.classList.add('hidden');
  elements.appView.classList.remove('hidden');
  elements.userBadge.textContent = state.user?.username || '';
}

function markDirty(dirty) {
  state.dirty = dirty;
  elements.saveButton.disabled = !state.currentPath || !dirty;
  elements.dirtyState.textContent = dirty ? 'Nicht gespeichert' : 'Gespeichert';
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getEditorLineCount() {
  if (elements.editor.disabled && !state.currentPath) {
    return 0;
  }
  return Math.max(1, elements.editor.value.split('\n').length);
}

function getIndentWidth(line) {
  return line.match(/^ */)[0].length;
}

function getFoldRegion(lines, headerIndex) {
  const header = lines[headerIndex];
  if (header === undefined || header.trim() === '' || header.trim().startsWith('#')) {
    return null;
  }

  const headerIndent = getIndentWidth(header);
  let end = headerIndex;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') {
      continue;
    }
    if (getIndentWidth(lines[index]) > headerIndent) {
      end = index;
      continue;
    }
    break;
  }

  if (end === headerIndex) {
    return null;
  }
  return { start: headerIndex + 1, end };
}

function getFoldableFlags(lines) {
  const flags = new Array(lines.length).fill(false);
  let nextIndent = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      continue;
    }
    const indent = getIndentWidth(lines[index]);
    flags[index] = !trimmed.startsWith('#') && nextIndent > indent;
    nextIndent = indent;
  }
  return flags;
}

function getFullContent() {
  if (state.folds.length === 0) {
    return elements.editor.value;
  }
  const lines = elements.editor.value.split('\n');
  for (let index = state.folds.length - 1; index >= 0; index -= 1) {
    const fold = state.folds[index];
    lines.splice(fold.header, 0, ...fold.lines);
  }
  return lines.join('\n');
}

function fullToVisible(fullLine) {
  let offset = 0;
  for (const fold of state.folds) {
    const fullHeader = fold.header + offset;
    if (fullLine <= fullHeader) {
      break;
    }
    if (fullLine <= fullHeader + fold.lines.length) {
      return fold.header;
    }
    offset += fold.lines.length;
  }
  return fullLine - offset;
}

function applyEditorLines(lines) {
  const { scrollTop, scrollLeft } = elements.editor;
  elements.editor.value = lines.join('\n');
  elements.editor.scrollTop = scrollTop;
  elements.editor.scrollLeft = scrollLeft;
}

function toggleFold(headerLine) {
  const lines = elements.editor.value.split('\n');
  const existing = state.folds.find((fold) => fold.header === headerLine);

  if (existing) {
    lines.splice(headerLine, 0, ...existing.lines);
    state.folds = state.folds.filter((fold) => fold !== existing);
    for (const fold of state.folds) {
      if (fold.header > headerLine) {
        fold.header += existing.lines.length;
      }
    }
  } else {
    const region = getFoldRegion(lines, headerLine - 1);
    if (!region) {
      return;
    }
    const visibleLength = region.end - region.start + 1;

    // Bereits gefaltete Bloecke innerhalb der Region zuerst wieder einsetzen,
    // damit keine verschachtelten Folds mit veralteten Positionen zurueckbleiben.
    const innerFolds = state.folds
      .filter((fold) => fold.header - 1 >= region.start && fold.header - 1 <= region.end)
      .sort((a, b) => b.header - a.header);
    for (const fold of innerFolds) {
      lines.splice(fold.header, 0, ...fold.lines);
      region.end += fold.lines.length;
      state.folds = state.folds.filter((other) => other !== fold);
    }

    const hidden = lines.splice(region.start, region.end - region.start + 1);
    for (const fold of state.folds) {
      if (fold.header > headerLine) {
        fold.header -= visibleLength;
      }
    }
    state.folds.push({ header: headerLine, lines: hidden });
    state.folds.sort((a, b) => a.header - b.header);
  }

  applyEditorLines(lines);
  updateEditorStats();
}

function getLineOfOffset(offset) {
  return elements.editor.value.slice(0, offset).split('\n').length;
}

function unfoldAll() {
  if (state.folds.length === 0) {
    return;
  }

  const { selectionStart, selectionEnd, scrollTop, scrollLeft } = elements.editor;
  const startLine = getLineOfOffset(selectionStart);
  const endLine = getLineOfOffset(selectionEnd);
  let startDelta = 0;
  let endDelta = 0;
  for (const fold of state.folds) {
    const hiddenLength = fold.lines.join('\n').length + 1;
    if (fold.header < startLine) {
      startDelta += hiddenLength;
    }
    if (fold.header < endLine) {
      endDelta += hiddenLength;
    }
  }

  elements.editor.value = getFullContent();
  state.folds = [];
  elements.editor.setSelectionRange(selectionStart + startDelta, selectionEnd + endDelta);
  elements.editor.scrollTop = scrollTop;
  elements.editor.scrollLeft = scrollLeft;
  updateEditorStats();
}

function getIssueMap() {
  const issueMap = new Map();
  for (const message of state.lintMessages) {
    const fullLine = Number.parseInt(message.line, 10);
    if (!Number.isInteger(fullLine) || fullLine < 1) {
      continue;
    }
    const line = fullToVisible(fullLine);

    const previous = issueMap.get(line);
    const severity = message.severity === 'error' || previous?.severity === 'error' ? 'error' : 'warning';
    const messages = previous?.messages || [];
    messages.push(message.message);
    issueMap.set(line, { severity, messages });
  }
  return issueMap;
}

function renderEditorAnnotations() {
  const lineCount = getEditorLineCount();
  const issueMap = getIssueMap();
  const lines = elements.editor.value.split('\n');
  const foldableFlags = getFoldableFlags(lines);
  const foldedHeaders = new Set(state.folds.map((fold) => fold.header));
  const lineFragment = document.createDocumentFragment();
  const highlightFragment = document.createDocumentFragment();
  let foldIndex = 0;
  let hiddenOffset = 0;

  for (let line = 1; line <= lineCount; line += 1) {
    while (foldIndex < state.folds.length && state.folds[foldIndex].header < line) {
      hiddenOffset += state.folds[foldIndex].lines.length;
      foldIndex += 1;
    }

    const issue = issueMap.get(line);
    const severityClass = issue ? ` ${issue.severity}` : '';
    const title = issue?.messages.join('\n') || '';
    const folded = foldedHeaders.has(line);
    const foldable = folded || foldableFlags[line - 1];

    const lineNumber = document.createElement('span');
    lineNumber.className = `line-number${severityClass}`;
    const caret = document.createElement('span');
    caret.className = 'fold-caret';
    const label = document.createElement('span');
    label.textContent = line + hiddenOffset;
    lineNumber.append(caret, label);
    if (title) {
      lineNumber.title = title;
    }
    if (foldable) {
      caret.textContent = folded ? '▸' : '▾';
      lineNumber.classList.add('foldable');
      if (folded) {
        lineNumber.classList.add('folded');
      }
      if (!title) {
        lineNumber.title = folded ? 'Aufklappen' : 'Einklappen';
      }
      const targetLine = line;
      lineNumber.addEventListener('click', () => toggleFold(targetLine));
    }
    lineFragment.append(lineNumber);

    const highlight = document.createElement('span');
    highlight.className = `issue-highlight${severityClass}`;
    if (title) {
      highlight.title = title;
    }
    highlightFragment.append(highlight);
  }

  elements.lineNumbers.replaceChildren(lineFragment);
  elements.issueHighlightList.replaceChildren(highlightFragment);
  syncEditorScroll();
}

function syncEditorScroll() {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
  elements.issueHighlights.scrollTop = elements.editor.scrollTop;
  elements.syntaxHighlight.scrollTop = elements.editor.scrollTop;
  elements.syntaxHighlight.scrollLeft = elements.editor.scrollLeft;
}

function getEditorLineHeight() {
  return Number.parseFloat(window.getComputedStyle(elements.editor).lineHeight) || 22;
}

function getLineStartOffset(lineNumber) {
  const lines = elements.editor.value.split('\n');
  let offset = 0;
  for (let index = 0; index < Math.min(lineNumber - 1, lines.length); index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function focusEditorLine(lineNumber) {
  const line = Number.parseInt(lineNumber, 10);
  if (!Number.isInteger(line) || line < 1) {
    return;
  }

  unfoldAll();
  const lines = elements.editor.value.split('\n');
  const offset = getLineStartOffset(line);
  const selectedLine = lines[line - 1] || '';
  elements.editor.focus();
  elements.editor.setSelectionRange(offset, offset + selectedLine.length);
  elements.editor.scrollTop = Math.max(0, (line - 1) * getEditorLineHeight() - 60);
  syncEditorScroll();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapSpan(cls, raw) {
  return `<span class="${cls}">${escapeHtml(raw)}</span>`;
}

function tokenizeValue(raw) {
  if (!raw) return '';
  const out = [];
  let plain = '';
  let i = 0;

  const flush = () => { if (plain) { out.push(escapeHtml(plain)); plain = ''; } };

  while (i < raw.length) {
    const ch = raw[i];
    const rest = raw.slice(i);

    if (ch === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      flush();
      out.push(wrapSpan('hl-comment', rest));
      break;
    }
    if (ch === '"') {
      flush();
      const m = rest.match(/^"(?:[^"\\]|\\.)*"/);
      const s = m ? m[0] : rest;
      out.push(wrapSpan('hl-string', s));
      i += s.length;
      continue;
    }
    if (ch === "'") {
      flush();
      const m = rest.match(/^'[^']*'/);
      const s = m ? m[0] : rest;
      out.push(wrapSpan('hl-string', s));
      i += s.length;
      continue;
    }
    if ((ch === '&' || ch === '*') && /\w/.test(raw[i + 1] || '')) {
      flush();
      const m = rest.match(/^[&*]\w+/);
      out.push(wrapSpan('hl-anchor', m[0]));
      i += m[0].length;
      continue;
    }
    if (/\w/.test(ch) && (i === 0 || !/\w/.test(raw[i - 1]))) {
      const kw = rest.match(/^(true|false|null|yes|no|on|off|~)(?!\w)/i);
      if (kw) {
        flush();
        out.push(wrapSpan('hl-bool', kw[1]));
        i += kw[1].length;
        continue;
      }
      const num = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?!\w)/);
      if (num) {
        flush();
        out.push(wrapSpan('hl-number', num[0]));
        i += num[0].length;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out.join('');
}

function highlightLine(line) {
  const m = line.match(/^(\s*)(.*)/s);
  const indent = escapeHtml(m[1]);
  const rest = m[2];
  if (!rest) return indent || '';

  if (/^---\s*$|^\.\.\.\s*$/.test(rest)) {
    return indent + wrapSpan('hl-marker', rest);
  }
  if (rest[0] === '#') {
    return indent + wrapSpan('hl-comment', rest);
  }

  let prefix = '';
  let content = rest;
  const listM = content.match(/^(-\s*)(.*)/s);
  if (listM) {
    prefix = wrapSpan('hl-list', listM[1]);
    content = listM[2];
  }

  const keyM = content.match(/^([\w][\w .-]*)(\s*:[ \t]?)(.*)/s);
  if (keyM) {
    return indent + prefix + wrapSpan('hl-key', keyM[1]) + escapeHtml(keyM[2]) + tokenizeValue(keyM[3]);
  }

  return indent + prefix + tokenizeValue(content);
}

function updateSyntaxHighlight() {
  if (elements.editor.disabled || !state.currentPath) {
    elements.syntaxHighlight.innerHTML = '';
    return;
  }
  const text = elements.editor.value;
  if (text.length > 100_000) {
    elements.syntaxHighlight.innerHTML = '';
    return;
  }
  const foldBadges = new Map(state.folds.map((fold) => [fold.header, fold.lines.length]));
  elements.syntaxHighlight.innerHTML = text.split('\n').map((line, index) => {
    let html = highlightLine(line);
    const hiddenCount = foldBadges.get(index + 1);
    if (hiddenCount) {
      html += `<span class="hl-fold-badge">… ${hiddenCount} ${hiddenCount === 1 ? 'Zeile' : 'Zeilen'}</span>`;
    }
    return html;
  }).join('\n');
}

function updateEditorStats() {
  const content = getFullContent();
  const lines = elements.editor.disabled && !state.currentPath
    ? 0
    : Math.max(1, content.split('\n').length);
  elements.editorStats.textContent = `${lines} Zeilen, ${formatBytes(new Blob([content]).size)}`;
  renderEditorAnnotations();
  updateSyntaxHighlight();
  scheduleYamlLint(content);
}

function setLintStatus(text, className = '') {
  elements.yamlCheck.textContent = text;
  elements.yamlCheck.className = className;
}

function renderLintMessages(messages) {
  state.lintMessages = messages;
  renderEditorAnnotations();
  elements.lintList.replaceChildren();

  if (messages.length === 0) {
    elements.lintPanel.classList.add('hidden');
    elements.lintSummary.textContent = 'YAML-Lint';
    setLintStatus('YAML OK', 'ok');
    return;
  }

  elements.lintPanel.classList.remove('hidden');
  const errorCount = messages.filter((message) => message.severity === 'error').length;
  const warningCount = messages.length - errorCount;
  const summary = [
    errorCount ? `${errorCount} Fehler` : '',
    warningCount ? `${warningCount} Warnungen` : ''
  ].filter(Boolean).join(', ');

  elements.lintSummary.textContent = summary;
  setLintStatus(summary, errorCount ? 'error' : 'warn');

  for (const message of messages.slice(0, 8)) {
    const item = document.createElement('li');
    item.className = `lint-item ${message.severity}`;
    const location = message.line ? `Zeile ${message.line}${message.column ? `:${message.column}` : ''}` : 'YAML';
    item.innerHTML = `
      <span class="lint-severity"></span>
      <span class="lint-location"></span>
      <span class="lint-message"></span>
    `;
    item.querySelector('.lint-severity').textContent = message.severity === 'error' ? 'Fehler' : 'Warnung';
    item.querySelector('.lint-location').textContent = location;
    item.querySelector('.lint-message').textContent = message.message;
    if (message.line) {
      item.tabIndex = 0;
      item.title = 'Zur Zeile springen';
      item.addEventListener('click', () => focusEditorLine(message.line));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          focusEditorLine(message.line);
        }
      });
    }
    elements.lintList.append(item);
  }
}

function scheduleYamlLint(content) {
  window.clearTimeout(state.lintTimer);
  if (!state.currentPath || elements.editor.disabled) {
    state.lintMessages = [];
    renderEditorAnnotations();
    elements.lintPanel.classList.add('hidden');
    setLintStatus('YAML-Lint bereit');
    return;
  }

  setLintStatus('YAML wird geprueft');
  state.lintRequestId += 1;
  state.lintMessages = [];
  renderEditorAnnotations();
  elements.lintPanel.classList.add('hidden');
  elements.lintList.replaceChildren();
  elements.lintSummary.textContent = 'YAML-Lint';
  state.lintTimer = window.setTimeout(() => runYamlLint(content), 300);
}

async function runYamlLint(content) {
  const requestId = ++state.lintRequestId;
  try {
    const payload = await api('/api/lint', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    if (requestId !== state.lintRequestId) {
      return;
    }
    renderLintMessages(payload.messages || []);
  } catch (error) {
    if (requestId !== state.lintRequestId) {
      return;
    }
    state.lintMessages = [];
    renderEditorAnnotations();
    elements.lintPanel.classList.add('hidden');
    setLintStatus(error.message, 'error');
  }
}

function matchesSearch(file) {
  const query = elements.fileSearch.value.trim().toLowerCase();
  return !query || file.path.toLowerCase().includes(query);
}

function renderFiles() {
  const visibleFiles = state.files.filter(matchesSearch);
  elements.fileList.replaceChildren();

  for (const file of visibleFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = file.path === state.currentPath ? 'file-row active' : 'file-row';
    button.title = file.path;
    button.innerHTML = `
      <span class="file-name"></span>
      <span class="file-meta"></span>
    `;
    button.querySelector('.file-name').textContent = file.path;
    button.querySelector('.file-meta').textContent = formatBytes(file.size);
    button.addEventListener('click', () => openFile(file.path));
    elements.fileList.append(button);
  }

  if (visibleFiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent = 'Keine YAML-Dateien';
    elements.fileList.append(empty);
  }

  elements.fileListMeta.textContent = `${visibleFiles.length} von ${state.files.length}`;
}

async function loadFiles() {
  const payload = await api('/api/files');
  state.files = payload.files;
  renderFiles();
  if (payload.truncated) {
    showToast('Dateiliste gekuerzt');
  }
}

async function openFile(filePath) {
  if (state.dirty && !window.confirm('Ungespeicherte Aenderungen verwerfen?')) {
    return;
  }

  const payload = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
  state.currentPath = payload.path;
  state.currentMtimeMs = payload.mtimeMs;
  state.folds = [];
  elements.currentFileName.textContent = payload.path;
  elements.editor.disabled = false;
  elements.editor.value = payload.content;
  elements.editor.scrollTop = 0;
  elements.reloadButton.disabled = false;
  elements.formatButton.disabled = false;
  state.lintMessages = [];
  markDirty(false);
  updateEditorStats();
  renderFiles();
  elements.editor.focus();
}

async function saveCurrentFile() {
  if (!state.currentPath) {
    return;
  }

  const payload = await api('/api/file', {
    method: 'POST',
    body: JSON.stringify({
      path: state.currentPath,
      content: getFullContent(),
      mtimeMs: state.currentMtimeMs
    })
  });

  state.currentMtimeMs = payload.mtimeMs;
  markDirty(false);
  showToast('Gespeichert');
  await loadFiles();
}

async function formatCurrentFile() {
  if (!state.currentPath) {
    return;
  }

  unfoldAll();
  const content = elements.editor.value;
  try {
    const payload = await api('/api/format', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    if (payload.content === content) {
      showToast('Bereits sauber formatiert');
      return;
    }
    elements.editor.value = payload.content;
    markDirty(true);
    updateEditorStats();
    showToast('YAML formatiert');
  } catch (error) {
    showToast(error.message);
  }
}

async function createNewFile(event) {
  event.preventDefault();
  const path = elements.newFilePath.value.trim();
  if (!path) {
    elements.newFilePath.focus();
    return;
  }

  await api('/api/file', {
    method: 'POST',
    body: JSON.stringify({
      path,
      content: '---\n'
    })
  });

  elements.newFilePath.value = '';
  await loadFiles();
  await openFile(path);
}

async function login(event) {
  event.preventDefault();
  elements.loginError.textContent = '';

  try {
    state.user = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: elements.username.value,
        password: elements.password.value
      })
    });
    showApp();
    await loadFiles();
  } catch (error) {
    elements.loginError.textContent = error.message;
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST' }).catch(() => null);
  state.user = null;
  state.files = [];
  state.currentPath = null;
  state.currentMtimeMs = null;
  state.lintRequestId += 1;
  state.lintMessages = [];
  state.folds = [];
  window.clearTimeout(state.lintTimer);
  elements.editor.value = '';
  elements.editor.disabled = true;
  elements.reloadButton.disabled = true;
  elements.formatButton.disabled = true;
  elements.syntaxHighlight.innerHTML = '';
  renderEditorAnnotations();
  elements.lintPanel.classList.add('hidden');
  setLintStatus('YAML-Lint bereit');
  showLogin();
}

async function init() {
  initTheme();
  elements.loginForm.addEventListener('submit', login);
  elements.logoutButton.addEventListener('click', logout);
  elements.refreshFilesButton.addEventListener('click', loadFiles);
  elements.fileSearch.addEventListener('input', renderFiles);
  elements.newFileForm.addEventListener('submit', createNewFile);
  elements.reloadButton.addEventListener('click', () => state.currentPath && openFile(state.currentPath));
  elements.saveButton.addEventListener('click', saveCurrentFile);
  elements.formatButton.addEventListener('click', formatCurrentFile);
  elements.editor.addEventListener('beforeinput', () => {
    // Bearbeiten arbeitet immer auf dem vollstaendigen Text.
    unfoldAll();
  });
  elements.editor.addEventListener('input', () => {
    markDirty(true);
    updateEditorStats();
  });
  elements.editor.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      unfoldAll();
      const start = elements.editor.selectionStart;
      const end = elements.editor.selectionEnd;
      const value = elements.editor.value;
      elements.editor.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      elements.editor.selectionStart = elements.editor.selectionEnd = start + 2;
      markDirty(true);
      updateEditorStats();
    }
  });
  elements.editor.addEventListener('scroll', syncEditorScroll);
  window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveCurrentFile();
    }
    if (event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      formatCurrentFile();
    }
  });

  try {
    state.user = await api('/api/me');
    elements.username.value = state.user.username;
    showApp();
    await loadFiles();
  } catch {
    elements.username.value = 'admin';
    showLogin();
  }
}

init();
