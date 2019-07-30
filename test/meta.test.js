'use strict';

const { Project, TypeGuards, ExportedDeclarations } = require('ts-morph');
const assert = require('assert');

describe.only('test/meta.test.js', () => {

  it('should extract meta', async () => {
    const project = new Project();
    project.addExistingSourceFiles('test/fixtures/**/*.js');
    const mainFile = project.getSourceFileOrThrow('meta.js');

    for (const [ name, declarations ] of declarations) {
      console.log(`${name}: ${declarations.map(d => d.getText()).join(', ')}`);
    }
  });
});
