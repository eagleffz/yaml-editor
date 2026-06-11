import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer, formatYamlContent, isYamlFileName, lintYamlContent, resolveYamlPath } from '../src/server.js';

function testConfig(dataDir) {
  return {
    dataDir,
    username: 'admin',
    password: 'secret',
    sessionSecret: 'test-secret',
    sessionTtlSeconds: 3600,
    cookieSecure: false,
    maxFileBytes: 1024 * 1024,
    maxListFiles: 100
  };
}

test('YAML filename filter accepts only YAML extensions', () => {
  assert.equal(isYamlFileName('config.yaml'), true);
  assert.equal(isYamlFileName('nested/config.yml'), true);
  assert.equal(isYamlFileName('config.json'), false);
  assert.equal(isYamlFileName('config.yaml.bak'), false);
});

test('path resolver keeps access inside data directory', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaml-editor-paths-'));
  const config = testConfig(dataDir);

  assert.equal(resolveYamlPath('nested/config.yaml', config).relativePath, 'nested/config.yaml');
  assert.throws(() => resolveYamlPath('../config.yaml', config), /Invalid file path/);
  assert.throws(() => resolveYamlPath('/etc/passwd.yaml', config), /Invalid file path/);
  assert.throws(() => resolveYamlPath('config.txt', config), /Only .yaml/);
});

test('YAML linter reports parser errors and style warnings', () => {
  assert.equal(lintYamlContent('name: example\n').valid, true);

  const invalid = lintYamlContent('name: [broken\n');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.messages[0].severity, 'error');
  assert.equal(invalid.messages[0].line, 2);

  const warning = lintYamlContent('name: example  \n');
  assert.equal(warning.valid, true);
  assert.equal(warning.messages[0].severity, 'warning');
  assert.match(warning.messages[0].message, /Leerzeichen/);
});

test('YAML formatter cleans up indentation and keeps comments', () => {
  const formatted = formatYamlContent('# comment\nname:    example\nlist:\n    - a\n    - b\n');
  assert.equal(formatted, '# comment\nname: example\nlist:\n  - a\n  - b\n');

  assert.equal(formatYamlContent(''), '');
  assert.throws(() => formatYamlContent('name: [broken\n'), /formatiert/);
});

test('API logs in, lists, reads and saves YAML files', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaml-editor-api-'));
  await fs.writeFile(path.join(dataDir, 'example.yaml'), 'name: example\n', 'utf8');

  const server = createServer(testConfig(dataDir));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const denied = await fetch(`${baseUrl}/api/files`);
  assert.equal(denied.status, 401);

  const login = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /yaml_editor_session=/);

  const list = await fetch(`${baseUrl}/api/files`, { headers: { cookie } });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).files.map((file) => file.path), ['example.yaml']);

  const read = await fetch(`${baseUrl}/api/file?path=example.yaml`, { headers: { cookie } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, 'name: example\n');

  const save = await fetch(`${baseUrl}/api/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ path: 'nested/new.yml', content: 'enabled: true\n' })
  });
  assert.equal(save.status, 200);
  assert.equal(await fs.readFile(path.join(dataDir, 'nested', 'new.yml'), 'utf8'), 'enabled: true\n');

  const lint = await fetch(`${baseUrl}/api/lint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ content: 'name: [broken\n' })
  });
  assert.equal(lint.status, 200);
  assert.equal((await lint.json()).valid, false);
});
