import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const digest = (number) =>
  `ghcr.io/fernandesthales/docker-learn@sha256:${String(number).padStart(64, '0')}`;
const revision = 'a'.repeat(40);
test('deployment records enforce immutable promotion, stale-build guard, and rollback', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'taskroom-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'envs'));
  mkdirSync(join(directory, 'bin'));
  for (const environment of ['dev', 'stage', 'prod'])
    writeFileSync(join(directory, 'envs', environment + '.env'), '');
  copyFileSync(
    new URL('../deploy/release.sh', import.meta.url),
    join(directory, 'release.sh')
  );
  writeFileSync(
    join(directory, 'bin', 'docker'),
    `#!/usr/bin/env python3
import sys,os,json
from pathlib import Path
a=sys.argv[1:]
p=Path(os.environ['MOCK_DIR'])
if a[0]=='ps':
 for v in a:
  if v.startswith('label=com.docker.compose.project='): print(v.split('=')[-1])
elif a[0]=='inspect':
 target=a[-1].replace('taskroom-','')
 if 'Health' in a[2]: print('healthy')
 else: print(json.load(open(p/'state'/f'{target}.json'))['image'])
elif a[0]=='compose':
 with open(p/'calls','a') as f: f.write(json.dumps(dict(args=a,image=os.environ.get('IMAGE_REFERENCE')))+'\\n')
 if 'up' in a and os.environ.get('FAIL_IMAGE') == os.environ.get('IMAGE_REFERENCE'): sys.exit(1)
else: sys.exit(2)
`,
    { mode: 0o755 }
  );
  function run(args, extra = {}) {
    return spawnSync('bash', [join(directory, 'release.sh'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: join(directory, 'bin') + ':' + process.env.PATH,
        MOCK_DIR: directory,
        ...extra
      }
    });
  }
  const record = (target) =>
    JSON.parse(
      readFileSync(join(directory, 'state', target + '.json'), 'utf8')
    );
  let result = run(['dev', digest(1), revision, '10']);
  assert.equal(result.status, 0, result.stderr);
  result = run(['stage']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(record('stage').image, digest(1));
  result = run(['dev', digest(2), revision, '11']);
  assert.equal(result.status, 0, result.stderr);
  result = run(['prod']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(record('prod').image, digest(1));
  result = run(['dev', digest(1), revision, '9']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(record('dev').image, digest(2));
  result = run(['dev', digest(3), revision, '12'], { FAIL_IMAGE: digest(3) });
  assert.equal(result.status, 1);
  assert.equal(record('dev').image, digest(2));
  const calls = readFileSync(join(directory, 'calls'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(
    calls
      .slice(-2)
      .some((call) => call.args.includes('up') && call.image === digest(2)),
    'failed release restored previous image'
  );
  result = run(['dev', 'ghcr.io/other/repo:latest', revision, '13']);
  assert.equal(result.status, 2);
});
