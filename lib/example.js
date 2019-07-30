'use strict';

const path = require('path');
const { fs } = require('mz');
const { rimraf, mkdirp, sleep } = require('mz-modules');
const { Project, SyntaxKind } = require('ts-morph');
const { isPropertyAccessExpression, isToken, isFunctionExpression, isArrowFunction } = require('typescript');
const ts = require('typescript');

function getExportPropName(expr) {

  if (isPropertyAccessExpression(expr.compilerNode)) {
    const children = expr.getChildren();
    if (children[0].getText() !== 'exports') return null;
    if (!isToken(children[1].compilerNode) || children[1].getText() !== '.') return null;

    return children[2].getText();
  }
  return null;
}

function transpile(sourceFile) {
  const functions = [];
  for (const statement of sourceFile.getStatements()) {
    const children = statement.getChildrenOfKind(SyntaxKind.BinaryExpression);
    if (children.length) {
      const binaryExpr = children[0];

      const token = binaryExpr.getOperatorToken();
      if (token.getText() !== '=') continue;

      const functionName = getExportPropName(binaryExpr.getLeft());
      if (!functionName) continue;

      let parameters = [];
      let returnType = 'any';

      const right = binaryExpr.getRight();
      if (isFunctionExpression(right.compilerNode) || isArrowFunction(right.compilerNode)) {
        parameters = right.getParameters().map(p => {
          return {
            name: p.getText(),
            type: 'any',
            // type: p.getType().getText(),
          };
        });
        // returnType = right.getReturnType().getText();
      }
      functions.push({
        name: functionName,
        parameters: parameters.slice(1), // 第一个参数固定是 ctx
        returnType,
      });
    }
  }
  return functions;
}

function getAssignChecker(name) {
  // cache the variable of name
  const variableList = Array.isArray(name) ? name : [ name ];
  const nameAlias = {};
  const getRealName = name => {
    const realName = nameAlias[ name ] || name;
    const hitTarget = !!variableList.find(variable => {
      return (typeof variable === 'string')
        ? variable === realName
        : variable.test(realName);
    });
    return hitTarget ? realName : undefined;
  };

  return {
    check(el) {
      const { obj, key, value, node } = el;
      if (!obj || !value) {
        // const xx = name
        if (value) {
          const realName = getRealName(value.getText().trim());
          if (realName) {
            nameAlias[ getText(key) ] = realName;
          }
        }

        return;
      }

      const realName = getRealName(obj.getText().trim());
      if (realName) {
        return { name: realName, obj, key, value, node };
      }
    },
  };
}

function getText(node) {
  if (node) {
    if (ts.isIdentifier(node)) {
      return formatIdentifierName(node.text);
    } else if (ts.isStringLiteral(node)) {
      return node.text;
    } else if (ts.isQualifiedName(node)) {
      return getText(node.right);
    }
  }
  return '';
}

function formatIdentifierName(name) {
  return name.replace(/^("|')|("|')$/g, '');
}

function modifierHas(node, kind) {
  return node.modifiers && node.modifiers.find(mod => kind === mod.kind);
}

function getAssignResultFromStatement(statement, assignList = []) {
  // check binary expression
  const checkBinary = node => {
    if (
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.name)
    ) {
      // xxx.xxx = xx
      assignList.push({
        obj: node.left.expression,
        key: node.left.name,
        value: checkValue(node.right),
        node: statement,
      });
    } else if (ts.isIdentifier(node.left)) {
      // xxx = xx
      assignList.push({
        key: node.left,
        value: checkValue(node.right),
        node: statement,
      });
    } else if (
      ts.isElementAccessExpression(node.left) &&
      ts.isStringLiteral(node.left.argumentExpression)
    ) {
      // xxx['sss'] = xxx
      assignList.push({
        obj: node.left.expression,
        key: ts.createIdentifier(node.left.argumentExpression.text),
        value: checkValue(node.right),
        node: statement,
      });
    }
  };

  const checkValue = node => {
    if (node && ts.isBinaryExpression(node)) {
      checkBinary(node);
      return checkValue(node.right);
    }
    return node;
  };

  const eachStatement = statements => {
    statements.forEach(statement => getAssignResultFromStatement(statement, assignList));
  };

  const checkIfStatement = el => {
    if (ts.isBlock(el.thenStatement)) {
      eachStatement(el.thenStatement.statements);
    }

    if (el.elseStatement) {
      if (ts.isIfStatement(el.elseStatement)) {
        checkIfStatement(el.elseStatement);
      } else if (ts.isBlock(el.elseStatement)) {
        eachStatement(el.elseStatement.statements);
      }
    }
  };

  if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
    // xxx = xxx
    checkBinary(statement.expression);
  } else if (ts.isVariableStatement(statement)) {
    // const xxx = xx
    statement.declarationList.declarations.forEach(declare => {
      if (ts.isIdentifier(declare.name)) {
        assignList.push({
          init: true,
          key: declare.name,
          value: checkValue(declare.initializer),
          node: declare,
        });
      }
    });
  } else if (ts.isIfStatement(statement)) {
    // if () { xxx = xxx }
    checkIfStatement(statement);
  }

  return assignList;
}

function findExports(sourceFile) {
  let exportEqual;
  const exportList = new Map();
  const checker = getAssignChecker([
    'exports',
    'module',
    'module.exports',
  ]);

  const addExportNode = (name, value, node) => {
    exportList.set(name, {
      node: value,
      originalNode: node,
    });
  };

  sourceFile.statements.forEach(statement => {
    const isExport = modifierHas(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) {
        // export = {}
        exportEqual = {
          node: statement.expression,
          originalNode: statement,
        };
      } else {
        // export default {}
        addExportNode('default', statement.expression, statement);
      }

      return;
    } else if (isExport && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))) {
      if (modifierHas(statement, ts.SyntaxKind.DefaultKeyword)) {
        // export default function() {} | export default class xx {}
        addExportNode('default', statement, statement);
      } else {
        // export function xxx() {} | export class xx {}
        addExportNode(getText(statement.name), statement, statement);
      }

      return;
    } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
      // export { xxxx };
      statement.exportClause.elements.forEach(spec => {
        addExportNode(getText(spec.name), spec.propertyName || spec.name, statement);
      });

      return;
    }

    getAssignResultFromStatement(statement).forEach(result => {
      const newResult = checker.check(result);
      if (isExport) {
        // export const xxx = {};
        addExportNode(getText(result.key), result.value, result.node);
      }

      if (!newResult) return;
      if (newResult.name === 'exports' || newResult.name === 'module.exports') {
        // exports.xxx = {} | module.exports.xxx = {}
        addExportNode(getText(newResult.key), newResult.value, newResult.node);
      } else if (newResult.name === 'module' && getText(newResult.key) === 'exports') {
        // module.exports = {}
        exportEqual = {
          node: newResult.value,
          originalNode: newResult.node,
        };
      }
    });
  });

  return {
    exportEqual,
    exportList,
  };
}

async function run() {

  const sourceFile = ts.createSourceFile('meta.js', await fs.readFile('test/fixtures/meta.js', 'utf-8'));
  const a = findExports(sourceFile);

  // const project = new Project();
  // project.addExistingSourceFiles('test/fixtures/**/*.js');
  // const mainFile = project.getSourceFile('meta.js');

  // const fn = transpile(mainFile);
  // console.log(fn)

  // for (const [ name, declarations ] of mainFile.getExportDeclarations()) {
  //   console.log(`${name}: ${declarations.map(d => d.getText()).join(', ')}`);
  // }

}

run().catch(console.error);
