'use strict';

const globby = require('globby');
const path = require('path');
const runScript = require('runscript');
const { rimraf } = require('mz-modules');
const assert = require('assert');

describe.only('test/index.test.js', () => {
  const cwd = path.join(__dirname, 'fixtures');
  const targetDir = path.join(cwd, '.sff');

  before(() => rimraf(path.join(targetDir, 'node_modules')));

  it('will ignore .sff', async () => {
    const result = await globby([ '*', '**' ], {
      cwd,
      ignore: [
        '**/node_modules',
      ],
      // followSymbolicLinks: false,
    });
    console.log(result);

    // work as expected, `.sff/a.js` is ignore by default
    assert.deepEqual(result, [ 'index.js', 'sub/user.js' ]);
  });

  it('should fail when node_modules contains SymbolicLinks', async () => {
    // use `cnpm/npminstsall` to install deps, which is link
    // test/fixtures/.sff/node_modules/@types/koa -> ../_@types_koa@2.0.50@@types/koa
    await runScript('npminstall @types/koa', { cwd: targetDir });

    const result = await globby([ '*', '**' ], {
      cwd,
      ignore: [
        '**/node_modules',
      ],
      // followSymbolicLinks: false,
    });

    // fail, throw error: Error: ENAMETOOLONG: name too long, scandir '/Users/tz/Workspaces/coding/github.com/atian25/node-snippets/test/fixtures/.sff/node_modules/_@types_koa@2.0.50@@types/koa/node_modules/@types/koa-compose/node_modules/@types/koa/node_modules/@types/koa-compose/node_modules/@types/koa/node_modules/@types/koa-compose
    // which is a dead loop due to SymbolicLinks
    // but `.sff` is ignore, should not follow it's SymbolicLinks
    console.log(result);
  });
});
