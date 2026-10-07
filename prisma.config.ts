import { Pool, type QueryResult } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * `experimental.adapter` makes the CLI run `migrate`/`db` commands through the
 * WASM schema engine driving `@prisma/adapter-pg`, instead of the native Rust
 * engine. The native engine cannot be used here because binaries.prisma.sh is
 * unreachable from this sandbox.
 *
 * KNOWN UPSTREAM BUG (verified present in @prisma/adapter-pg 6.16.3 and 6.19.0):
 * `fieldToColumnType()` has no case for PostgreSQL OID 19 (`name`), so every
 * schema-engine introspection query that selects a `name` column — e.g.
 * `SELECT namespace.nspname FROM pg_namespace` — is rejected with
 * "Column type 'name' could not be deserialized from the database.", and
 * `prisma migrate deploy` then applies zero migrations.
 *
 * The shim below does not change any SQL, skip any migration, or invent any
 * result: it simply re-runs a query the adapter refused over a plain `pg`
 * connection, mapping OID 19 to `Text` (Postgres already sends it as a string
 * on the wire). Every other OID uses the same mapping the adapter itself uses.
 * It is CLI-only — the running app builds its own adapter in src/lib/prisma.ts.
 */

const connectionString = process.env.DATABASE_URL
  || 'postgresql://invalid:invalid@127.0.0.1:5432/invalid';

const DEBUG = Boolean(process.env.PRISMA_DEBUG_ADAPTER);

/** Numeric values of Prisma's ColumnType enum (kept local to avoid a transitive import). */
const ColumnType = {
  Int32: 0,
  Int64: 1,
  Float: 2,
  Double: 3,
  Numeric: 4,
  Boolean: 5,
  Text: 7,
  DateTime: 10,
  Json: 11,
  Uuid: 15,
  Int32Array: 64,
  Int64Array: 65,
  FloatArray: 66,
  DoubleArray: 67,
  BooleanArray: 69,
  TextArray: 71,
  DateTimeArray: 74,
  JsonArray: 75,
  UuidArray: 78,
} as const;

const FIRST_NORMAL_OBJECT_ID = 16_384;

const OID_TO_COLUMN_TYPE: Record<number, number> = {
  16: ColumnType.Boolean,
  17: ColumnType.Text, // bytea is returned as a number[] by the adapter; introspection has none
  18: ColumnType.Text, // "char"
  19: ColumnType.Text, // name  <-- the whole reason this shim exists
  20: ColumnType.Int64,
  21: ColumnType.Int32,
  23: ColumnType.Int32,
  25: ColumnType.Text,
  26: ColumnType.Int64, // oid
  114: ColumnType.Json,
  700: ColumnType.Float,
  701: ColumnType.Double,
  1042: ColumnType.Text, // bpchar
  1043: ColumnType.Text, // varchar
  1082: ColumnType.DateTime, // date
  1083: ColumnType.DateTime, // time
  1114: ColumnType.DateTime, // timestamp
  1184: ColumnType.DateTime, // timestamptz
  1186: ColumnType.DateTime, // interval
  1266: ColumnType.DateTime, // timetz
  1700: ColumnType.Numeric, // numeric (adapter also returns it as a string)
  2950: ColumnType.Uuid,
  3802: ColumnType.Json, // jsonb
  1000: ColumnType.BooleanArray,
  1005: ColumnType.Int32Array,
  1007: ColumnType.Int32Array,
  1009: ColumnType.TextArray,
  1015: ColumnType.TextArray,
  1016: ColumnType.Int64Array,
  1021: ColumnType.FloatArray,
  1022: ColumnType.DoubleArray,
  1115: ColumnType.DateTimeArray,
  1185: ColumnType.DateTimeArray,
  1182: ColumnType.DateTimeArray,
  199: ColumnType.JsonArray,
  3807: ColumnType.JsonArray,
  2951: ColumnType.UuidArray,
};

function columnTypeForOid(oid: number): number {
  const known = OID_TO_COLUMN_TYPE[oid];
  if (known !== undefined) return known;
  // Mirror the adapter: user-defined / enum OIDs travel as text.
  if (oid >= FIRST_NORMAL_OBJECT_ID) return ColumnType.Text;
  throw new Error(`Unsupported PostgreSQL column OID ${oid}`);
}

function isUnsupportedColumnType(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { name?: string }).name === 'DriverAdapterError'
    && (error as { cause?: { kind?: string } }).cause?.kind === 'UnsupportedNativeDataType',
  );
}

let fallbackPool: Pool | null = null;
function sharedPool(): Pool {
  fallbackPool ??= new Pool({ connectionString, max: 1 });
  return fallbackPool;
}

type SqlQueryParams = { sql: string; args?: readonly unknown[] };
type Queryable = { queryRaw: (params: SqlQueryParams) => Promise<unknown> };

async function queryRawWithNameSupport(params: SqlQueryParams) {
  const result: QueryResult<unknown[]> = await sharedPool().query({
    text: params.sql,
    values: params.args ? [...params.args] : [],
    rowMode: 'array',
  });
  return {
    columnNames: result.fields.map((field) => field.name),
    columnTypes: result.fields.map((field) => columnTypeForOid(field.dataTypeID)),
    rows: result.rows,
  };
}

async function queryRawAllowingNameColumns(source: Queryable, params: SqlQueryParams) {
  try {
    return await source.queryRaw(params);
  } catch (error) {
    if (!isUnsupportedColumnType(error)) throw error;
    if (DEBUG) {
      console.error('[prisma.config] adapter rejected a `name`-typed column; re-running the query with OID 19 mapped to text');
    }
    return queryRawWithNameSupport(params);
  }
}

/**
 * Splits a SQL script into statements the way a server would: `;` inside a
 * line comment, a block comment, a quoted identifier or a string literal is
 * not a statement terminator.
 *
 * SECOND UPSTREAM BUG: `@prisma/adapter-pg.executeScript()` is a naive
 * `script.split(';')`, so a semicolon inside a `-- comment` truncates one
 * statement and prefixes the next with prose — which is exactly what happened
 * to migration 20260930000000_production_correctness ("syntax error at or near
 * \"all\""). The migration SQL is valid; only the splitter was wrong.
 */
function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < script.length) {
    const character = script[index];
    const next = script[index + 1];

    if (character === '-' && next === '-') {
      const end = script.indexOf('\n', index);
      const stop = end === -1 ? script.length : end;
      current += script.slice(index, stop);
      index = stop;
      continue;
    }

    if (character === '/' && next === '*') {
      const end = script.indexOf('*/', index + 2);
      const stop = end === -1 ? script.length : end + 2;
      current += script.slice(index, stop);
      index = stop;
      continue;
    }

    if (character === "'" || character === '"') {
      let cursor = index + 1;
      while (cursor < script.length) {
        if (script[cursor] === character) {
          if (script[cursor + 1] === character) { cursor += 2; continue; }
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      current += script.slice(index, cursor);
      index = cursor;
      continue;
    }

    if (character === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(script.slice(index));
      if (tag) {
        const end = script.indexOf(tag[0], index + tag[0].length);
        const stop = end === -1 ? script.length : end + tag[0].length;
        current += script.slice(index, stop);
        index = stop;
        continue;
      }
    }

    if (character === ';') {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }

    current += character;
    index += 1;
  }

  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

async function executeScriptSafely(source: object, script: string) {
  const pool = (source as { underlyingDriver?: () => Pool }).underlyingDriver?.() || sharedPool();
  for (const statement of splitSqlStatements(script)) {
    await pool.query(statement);
  }
}

/** Proxies `queryRaw` (and any transaction handed out) on a Prisma connection. */
function withNameSupport<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === 'queryRaw') {
        return (params: SqlQueryParams) => queryRawAllowingNameColumns(target as unknown as Queryable, params);
      }
      if (property === 'executeScript') {
        return (script: string) => executeScriptSafely(target, script);
      }
      const inner = Reflect.get(target, property, receiver);
      if (typeof inner !== 'function') return inner;
      const bound = inner.bind(target) as (...args: unknown[]) => unknown;
      if (property === 'startTransaction') {
        return async (...args: unknown[]) => withNameSupport(await bound(...args) as object);
      }
      return bound;
    },
  }) as T;
}

const base = new PrismaPg({ connectionString });

/**
 * `PrismaPg` only exposes `connect()` / `connectToShadowDb()`; every query goes
 * through the connection (or a transaction) they return, so those are wrapped.
 */
const nameAwareAdapter = new Proxy(base, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (property !== 'connect' && property !== 'connectToShadowDb') {
      return typeof value === 'function' ? value.bind(target) : value;
    }
    const connect = value as (...args: unknown[]) => Promise<object>;
    return async (...args: unknown[]) => withNameSupport(await connect.apply(target, args));
  },
});

export default defineConfig({
  experimental: {
    adapter: true,
  },
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  adapter: async () => nameAwareAdapter as unknown as PrismaPg,
});
