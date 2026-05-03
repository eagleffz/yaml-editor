const state = {
  user: null,
  files: [],
  currentPath: null,
  currentMtimeMs: null,
  dirty: false,
  lintTimer: null,
  lintRequestId: 0
};

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
  reloadButton: document.querySelector('#reloadButton'),
  saveButton: document.querySelector('#saveButton'),
  editor: document.querySelector('#editor'),
  lintPanel: document.querySelector('#lintPanel'),
  lintSummary: document.querySelector('#lintSummary'),
  lintList: document.querySelector('#lintList'),
  dirtyState: document.querySelector('#dirtyState'),
  editorStats: document.querySelector('#editorStats'),
  yamlCheck: document.querySelector('#yamlCheck'),
  toast: document.querySelector('#toast')
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

function updateEditorStats() {
  const content = elements.editor.value;
  const lines = content.length === 0 ? 0 : content.split('\n').length;
  elements.editorStats.textContent = `${lines} Zeilen, ${formatBytes(new Blob([content]).size)}`;
  scheduleYamlLint(content);
}

function setLintStatus(text, className = '') {
  elements.yamlCheck.textContent = text;
  elements.yamlCheck.className = className;
}

function renderLintMessages(messages) {
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
    elements.lintList.append(item);
  }
}

function scheduleYamlLint(content) {
  window.clearTimeout(state.lintTimer);
  if (!state.currentPath || elements.editor.disabled) {
    elements.lintPanel.classList.add('hidden');
    setLintStatus('YAML-Lint bereit');
    return;
  }

  setLintStatus('YAML wird geprueft');
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
  elements.currentFileName.textContent = payload.path;
  elements.editor.disabled = false;
  elements.editor.value = payload.content;
  elements.reloadButton.disabled = false;
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
      content: elements.editor.value,
      mtimeMs: state.currentMtimeMs
    })
  });

  state.currentMtimeMs = payload.mtimeMs;
  markDirty(false);
  showToast('Gespeichert');
  await loadFiles();
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
  window.clearTimeout(state.lintTimer);
  elements.editor.value = '';
  elements.editor.disabled = true;
  elements.lintPanel.classList.add('hidden');
  setLintStatus('YAML-Lint bereit');
  showLogin();
}

async function init() {
  elements.loginForm.addEventListener('submit', login);
  elements.logoutButton.addEventListener('click', logout);
  elements.refreshFilesButton.addEventListener('click', loadFiles);
  elements.fileSearch.addEventListener('input', renderFiles);
  elements.newFileForm.addEventListener('submit', createNewFile);
  elements.reloadButton.addEventListener('click', () => state.currentPath && openFile(state.currentPath));
  elements.saveButton.addEventListener('click', saveCurrentFile);
  elements.editor.addEventListener('input', () => {
    markDirty(true);
    updateEditorStats();
  });
  window.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveCurrentFile();
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
