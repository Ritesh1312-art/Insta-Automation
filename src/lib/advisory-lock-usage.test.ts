/**
 * Regression guard for the production outage where an uncast
 * `pg_advisory_xact_lock` query made Prisma throw P2010 ("Failed to
 * deserialize column of type 'void'") on every comment-to-DM automation.
 *
 * Every JavaScript/TypeScript source file in the repository (application,
 * scripts, and configuration; tests, generated Prisma code, and build output
 * excluded) is parsed, and every string and template literal is checked:
 *  1. a void-returning advisory-lock call must have its result cast
 *     (`::text`, or `CAST(... AS text)`), and
 *  2. advisory-lock SQL may only appear in `src/lib/advisory-lock.ts`, so all
 *     callers go through the single helper.
 * Only literals are inspected, so comments and documentation may still name
 * the functions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HELPER_FILE = 'src/lib/advisory-lock.ts';
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.next', '.open-next', '.vercel', '.wrangler', 'coverage', 'dist', 'build', 'out']);
const SKIPPED_PREFIXES = ['src/generated/', 'src/test/'];
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** Any advisory-lock function reference, including try/unlock variants. */
const ADVISORY_LOCK_REFERENCE = /\bpg_(?:try_)?advisory_[a-z_]+/i;
/** Advisory-lock functions whose PostgreSQL return type is `void`. */
const VOID_ADVISORY_LOCK_CALL = /\b(?:pg_advisory(?:_xact)?_lock(?:_shared)?|pg_advisory_unlock_all)\s*\(/gi;

type Violation = { file: string; line: number; rule: 'uncast-void-lock' | 'lock-outside-helper'; snippet: string };
type Literal = { text: string; line: number };

function scriptKind(file: string) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function templateText(node: ts.TemplateExpression) {
  return node.head.text + node.templateSpans.map((span) => `$1${span.literal.text}`).join('');
}

/** Folds `'a' + key + 'b'` into `a$1b` so split SQL strings are still checked. */
function concatenatedText(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templateText(node);
  if (ts.isParenthesizedExpression(node)) return concatenatedText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = concatenatedText(node.left);
    const right = concatenatedText(node.right);
    return left === null && right === null ? null : `${left ?? '$1'}${right ?? '$1'}`;
  }
  return null;
}

function literalsIn(source: string, file: string): Literal[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  const literals: Literal[] = [];
  const add = (node: ts.Node, text: string) => {
    literals.push({ text, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) add(node, templateText(node));
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const text = concatenatedText(node);
      if (text !== null) add(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

function closingParenthesis(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

/** Returns the void advisory-lock calls in `sql` whose result is not cast. */
function uncastVoidLockCalls(sql: string) {
  const uncast: string[] = [];
  for (const match of sql.matchAll(VOID_ADVISORY_LOCK_CALL)) {
    const start = match.index;
    const close = closingParenthesis(sql, start + match[0].length - 1);
    const before = sql.slice(0, start);
    const after = close === -1 ? '' : sql.slice(close + 1);
    const castOperator = /^\s*::\s*(?!void\b)[a-z_]/i.test(after);
    const castFunction = /\bCAST\s*\(\s*$/i.test(before) && /^\s*AS\s+(?!void\b)[a-z_]/i.test(after);
    if (close === -1 || !(castOperator || castFunction)) uncast.push(sql.slice(start, close === -1 ? undefined : close + 1));
  }
  return uncast;
}

function scanSource(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  for (const literal of literalsIn(source, file)) {
    const snippet = literal.text.trim().slice(0, 160);
    for (const call of uncastVoidLockCalls(literal.text)) {
      violations.push({ file, line: literal.line, rule: 'uncast-void-lock', snippet: call });
    }
    if (file !== HELPER_FILE && ADVISORY_LOCK_REFERENCE.test(literal.text)) {
      violations.push({ file, line: literal.line, rule: 'lock-outside-helper', snippet });
    }
  }
  return violations;
}

function repositorySourceFiles(directory = REPO_ROOT, files: string[] = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !SKIPPED_PREFIXES.some((prefix) => `${relative}/`.startsWith(prefix))) {
        repositorySourceFiles(absolute, files);
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(relative);
    }
  }
  return files;
}

describe('advisory-lock usage scanner', () => {
  const lockKeyTemplate = 'tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))';

  it.each([
    ['the original uncast tagged template', `${lockKeyTemplate}\`;`],
    ['an unsafe raw string', `await prisma.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)', key);`],
    ['an executeRaw call', 'await tx.$executeRaw`SELECT pg_advisory_xact_lock(${id})`;'],
    ['a Prisma.sql fragment', 'const query = Prisma.sql`SELECT pg_advisory_lock(${id})`;'],
    ['mixed-case SQL', `const sql = "select PG_ADVISORY_XACT_LOCK(hashtext('k'))";`],
    ['shared and session variants', 'const a = "SELECT pg_advisory_xact_lock_shared(1)"; const b = "SELECT pg_advisory_lock_shared(1)";'],
    ['unlock-all, which also returns void', 'const sql = "SELECT pg_advisory_unlock_all()";'],
    ['SQL split across concatenated strings', `const sql = 'SELECT pg_advisory_xact_lock(' + key + ')';`],
    ['a cast applied to the argument instead of the result', 'const sql = `SELECT pg_advisory_xact_lock(${key}::bigint)`;'],
    ['a pointless cast to void', 'const sql = "SELECT pg_advisory_xact_lock(1)::void";'],
    ['a JavaScript script', 'module.exports = "SELECT pg_advisory_xact_lock(42)";'],
  ])('flags %s', (_label, code) => {
    const file = code.startsWith('module.exports') ? 'scripts/example.cjs' : 'src/lib/example.ts';
    const violations = scanSource(code, file);
    expect(violations.some((violation) => violation.rule === 'uncast-void-lock')).toBe(true);
  });

  it('flags even a correctly cast lock outside the helper, so every caller uses it', () => {
    expect(scanSource(`${lockKeyTemplate}::text AS "lockResult"\`;`, 'src/app/api/example/route.ts')).toEqual([
      expect.objectContaining({ rule: 'lock-outside-helper', line: 1 }),
    ]);
    expect(scanSource('const sql = "SELECT pg_try_advisory_xact_lock(1)";', 'src/lib/x.ts')).toEqual([
      expect.objectContaining({ rule: 'lock-outside-helper' }),
    ]);
  });

  it.each([
    ['a ::text cast', `${lockKeyTemplate}::text AS "lockResult"\`;`],
    ['a spaced cast', `${lockKeyTemplate} :: text\`;`],
    ['a CAST expression', 'const sql = `SELECT CAST(pg_advisory_xact_lock(${key}) AS text)`;'],
    ['a boolean try-lock', 'const sql = `SELECT pg_try_advisory_xact_lock(${key})`;'],
  ])('accepts %s inside the helper', (_label, code) => {
    expect(scanSource(code, HELPER_FILE)).toEqual([]);
  });

  it('ignores comments, which may document the functions', () => {
    const code = '// SELECT pg_advisory_xact_lock(1) is unsafe\n/* pg_advisory_lock(2) */\nexport const ok = 1;';
    expect(scanSource(code, 'src/lib/example.ts')).toEqual([]);
  });
});

describe('repository advisory-lock usage', () => {
  const files = repositorySourceFiles();

  it('scans application code, scripts, and configuration', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toEqual(expect.arrayContaining([
      HELPER_FILE, 'src/lib/quota.ts', 'src/lib/rate-limit.ts', 'src/lib/payment-review.ts',
      'src/app/api/automations/route.ts', 'src/app/api/auth/setup/route.ts', 'scripts/create-admin.ts', 'next.config.js',
    ]));
    expect(files.some((file) => file.startsWith('src/generated/') || TEST_FILE.test(file))).toBe(false);
  });

  it('has no uncast advisory-lock query and no lock SQL outside the helper', () => {
    const violations = files.flatMap((file) => scanSource(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file));
    expect(violations, 'Use withTransactionAdvisoryLock()/acquireTransactionAdvisoryLock() from src/lib/advisory-lock.ts').toEqual([]);
  });

  it('keeps exactly one lock query in the helper, cast to text', () => {
    const helperLocks = literalsIn(readFileSync(path.join(REPO_ROOT, HELPER_FILE), 'utf8'), HELPER_FILE)
      .filter((literal) => ADVISORY_LOCK_REFERENCE.test(literal.text));
    expect(helperLocks).toHaveLength(1);
    expect(helperLocks[0].text).toBe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lockResult"');
    expect(uncastVoidLockCalls(helperLocks[0].text)).toEqual([]);
  });
});
