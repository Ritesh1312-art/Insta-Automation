/**
 * In-memory stand-in for the generated Prisma client, for unit tests that need
 * real query semantics rather than per-call mocks.
 *
 * It deliberately reproduces the two behaviours that matter for advisory locks:
 *  - Prisma's driver adapters cannot deserialize PostgreSQL `void`, so a raw
 *    query selecting the lock function without a cast rejects with P2010,
 *    exactly as production does.
 *  - A transaction-scoped advisory lock is held until its interactive
 *    transaction settles, so transactions using the same key are serialized.
 *
 * Interactive transactions roll back their own writes when the callback
 * throws. Only the subset of the Prisma API used by this application is
 * implemented; anything else throws loudly instead of passing silently.
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;
type Where = Record<string, any>;

export type ModelName =
  | 'user' | 'metaConnection' | 'media' | 'resource' | 'automation' | 'webhookEvent'
  | 'automationRun' | 'contact' | 'automationContactState' | 'auditLog' | 'directUpiPayment'
  | 'metaDataDeletionRequest';

type Relation =
  | { kind: 'one'; model: ModelName; field: string; references: string }
  | { kind: 'many'; model: ModelName; field: string; references: string };

type Cascade = { model: ModelName; field: string; references: string };

type ModelConfig = {
  defaults: () => Row;
  unique: string[][];
  relations?: Record<string, Relation>;
  updatedAt?: boolean;
  /**
   * Child rows the database removes with this row through `ON DELETE CASCADE`
   * (see prisma/schema.prisma). PostgreSQL performs this itself; the double
   * emulates it so deletion tests can assert the same end state.
   */
  cascades?: Cascade[];
};

const MODEL_CONFIG: Record<ModelName, ModelConfig> = {
  user: {
    defaults: () => ({
      sessionVersion: 0, totalCommentsReceived: 0, name: null, role: 'USER', plan: 'FREE', monthlyDmQuota: 30,
      dmsUsedThisMonth: 0, quotaResetAt: null, planActivatedAt: null, adminUpiId: null, adminQrCodeUrl: null,
      razorpaySubscriptionId: null, razorpayCustomerId: null, telegramBotTokenEncrypted: null, telegramChatId: null,
      subscriptionStatus: 'INACTIVE',
    }),
    unique: [['id'], ['email']],
    updatedAt: true,
    relations: {
      automations: { kind: 'many', model: 'automation', field: 'id', references: 'userId' },
      directUpiPayments: { kind: 'many', model: 'directUpiPayment', field: 'id', references: 'userId' },
      metaConnections: { kind: 'many', model: 'metaConnection', field: 'id', references: 'userId' },
    },
  },
  metaConnection: {
    defaults: () => ({
      facebookPageId: null, profilePictureUrl: null, accessTokenEncrypted: null, tokenType: 'BEARER', scopes: [],
      expiresAt: null, connectionStatus: 'CONNECTED', webhookStatus: 'UNKNOWN',
    }),
    unique: [['id'], ['instagramAccountId']],
    updatedAt: true,
    relations: { user: { kind: 'one', model: 'user', field: 'userId', references: 'id' } },
    cascades: [
      { model: 'media', field: 'instagramAccountId', references: 'instagramAccountId' },
      { model: 'automation', field: 'instagramAccountId', references: 'instagramAccountId' },
      { model: 'contact', field: 'instagramAccountId', references: 'instagramAccountId' },
      { model: 'automationContactState', field: 'instagramAccountId', references: 'instagramAccountId' },
      { model: 'webhookEvent', field: 'instagramAccountId', references: 'instagramAccountId' },
    ],
  },
  media: {
    defaults: () => ({ caption: null, permalink: null, mediaUrl: null, thumbnailUrl: null }),
    unique: [['id'], ['instagramMediaId']],
    updatedAt: true,
  },
  resource: {
    defaults: () => ({ url: null, textContent: null }),
    unique: [['id']],
    updatedAt: true,
  },
  automation: {
    defaults: () => ({
      mediaId: null, resourceId: null, status: 'DRAFT', triggerType: 'KEYWORD', matchingMode: 'EXACT', keywords: [],
      ignoreOwnerComments: true, oneDeliveryPerUser: true, oneDeliveryPerComment: true, followGateEnabled: true,
      publicReplyEnabled: false, publicReplyTemplates: [], totalTriggers: 0, totalSuccess: 0, totalFailed: 0,
      lastTriggeredAt: null,
    }),
    unique: [['id']],
    updatedAt: true,
    relations: {
      user: { kind: 'one', model: 'user', field: 'userId', references: 'id' },
      media: { kind: 'one', model: 'media', field: 'mediaId', references: 'id' },
      resource: { kind: 'one', model: 'resource', field: 'resourceId', references: 'id' },
      metaConnection: { kind: 'one', model: 'metaConnection', field: 'instagramAccountId', references: 'instagramAccountId' },
      runs: { kind: 'many', model: 'automationRun', field: 'id', references: 'automationId' },
    },
    cascades: [{ model: 'automationRun', field: 'automationId', references: 'id' }],
  },
  webhookEvent: {
    defaults: () => ({
      instagramAccountId: null, eventId: null, commentId: null, mediaId: null, commenterId: null, commenterUsername: null,
      messagingSenderId: null, messagingPayload: null, interactionType: null, commentText: null, status: 'RECEIVED',
      errorDetails: null, retryCount: 0, nextRetryAt: null, processingStartedAt: null, processedAt: null,
    }),
    unique: [['id'], ['eventId']],
    relations: {
      metaConnection: { kind: 'one', model: 'metaConnection', field: 'instagramAccountId', references: 'instagramAccountId' },
    },
  },
  automationRun: {
    defaults: () => ({
      status: 'QUEUED', publicReplyStatus: null, dmStatus: null, dmResponseId: null, publicReplyId: null,
      errorCategory: null, errorMessage: null, retryCount: 0, nextRetryAt: null, executedAt: null,
    }),
    unique: [['id'], ['idempotencyKey']],
    updatedAt: true,
    relations: {
      automation: { kind: 'one', model: 'automation', field: 'automationId', references: 'id' },
      webhookEvent: { kind: 'one', model: 'webhookEvent', field: 'webhookEventId', references: 'id' },
    },
  },
  contact: {
    defaults: () => ({
      username: null, followedAt: null, promptSentAt: null, followGateStatus: 'NEW', lastAutomationId: null,
      claimedFollowAt: null, lastGateMessageAt: null, firstInteraction: new Date(), lastInteraction: new Date(),
      totalInteractions: 1,
    }),
    unique: [['id'], ['instagramAccountId', 'igsid']],
    updatedAt: true,
  },
  automationContactState: {
    defaults: () => ({ status: 'NEW', claimStartedAt: null, deliveredAt: null, lastCheckedAt: null }),
    unique: [['id'], ['automationId', 'igsid']],
    updatedAt: true,
  },
  auditLog: {
    defaults: () => ({ userId: null, details: null, ipAddress: null }),
    unique: [['id']],
  },
  directUpiPayment: {
    defaults: () => ({ status: 'PENDING_REVIEW', approvedAt: null, reviewedBy: null, reviewNote: null }),
    unique: [['id'], ['utrNumber']],
    updatedAt: true,
  },
  metaDataDeletionRequest: {
    defaults: () => ({
      status: 'PENDING', deletedConnections: 0, deletedMedia: 0, deletedAutomations: 0, deletedContacts: 0,
      deletedWebhookEvents: 0, errorDetails: null, completedAt: null,
    }),
    unique: [['id'], ['metaUserId'], ['confirmationCode']],
    updatedAt: true,
  },
};

export const MODEL_NAMES = Object.keys(MODEL_CONFIG) as ModelName[];

/** Error shaped like PrismaClientKnownRequestError. */
export class FakePrismaError extends Error {
  constructor(public readonly code: string, message: string, public readonly meta?: Record<string, unknown>) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
  }
}

export const VOID_DESERIALIZATION_MESSAGE =
  "Failed to deserialize column of type 'void'. If you're using $queryRaw and this column is explicitly marked as `Unsupported` in your Prisma schema, try casting this column to any supported Prisma type such as `String`.";

const VOID_ADVISORY_LOCK_CALL = /\bpg_advisory(?:_xact)?_lock(?:_shared)?\s*\(/i;

export type OperationRecord = { model: ModelName; operation: string; args: any; transactionId: number | null };
export type RawQueryRecord = { sql: string; values: unknown[]; transactionId: number | null };
export type LockEvent = { key: string; transactionId: number; event: 'acquired' | 'released' };
export type TransactionRecord = { id: number; options: unknown; outcome: 'pending' | 'committed' | 'rolled-back' };

type TransactionContext = {
  id: number;
  heldLocks: Map<string, () => void>;
  undo: Array<() => void>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function same(left: unknown, right: unknown) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function compare(left: any, right: any) {
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition === null) return value === null || value === undefined;
  if (!isPlainObject(condition)) return same(value, condition);
  return Object.entries(condition).every(([operator, operand]) => {
    if (operand === undefined) return true;
    const present = value !== null && value !== undefined;
    switch (operator) {
      case 'equals': return matchesField(value, operand);
      case 'not': return !matchesField(value, operand);
      case 'in': return (operand as unknown[]).some((candidate) => same(value, candidate));
      case 'notIn': return !(operand as unknown[]).some((candidate) => same(value, candidate));
      case 'lt': return present && compare(value, operand) < 0;
      case 'lte': return present && compare(value, operand) <= 0;
      case 'gt': return present && compare(value, operand) > 0;
      case 'gte': return present && compare(value, operand) >= 0;
      case 'has': return Array.isArray(value) && value.includes(operand);
      default: throw new Error(`FakePrisma: unsupported filter operator "${operator}"`);
    }
  });
}

export class FakePrisma {
  readonly tables: Record<ModelName, Row[]>;
  readonly operations: OperationRecord[] = [];
  readonly rawQueries: RawQueryRecord[] = [];
  readonly lockEvents: LockEvent[] = [];
  readonly transactions: TransactionRecord[] = [];
  private readonly lockTails = new Map<string, Promise<void>>();
  private nextTransactionId = 1;
  private readonly root: Record<string, any>;
  /** Fault injection: runs before every raw query and may throw (e.g. to replay a production error). */
  beforeRawQuery: ((sql: string, values: unknown[]) => void) | null = null;
  /** Fault injection: runs before every model operation and may throw. */
  beforeOperation: ((entry: OperationRecord) => void) | null = null;

  constructor() {
    this.tables = Object.fromEntries(MODEL_NAMES.map((name) => [name, []])) as unknown as Record<ModelName, Row[]>;
    this.root = this.buildClient(null);
  }

  /** The object to hand to `vi.mock('@/lib/prisma', () => ({ prisma }))`. */
  get client(): any {
    return this.root;
  }

  /** Empties every table and log; the client object stays the same. */
  reset() {
    for (const name of MODEL_NAMES) this.tables[name].length = 0;
    this.operations.length = 0;
    this.rawQueries.length = 0;
    this.lockEvents.length = 0;
    this.transactions.length = 0;
    this.lockTails.clear();
    this.beforeRawQuery = null;
    this.beforeOperation = null;
  }

  /** Inserts rows directly (defaults applied, constraints enforced, not logged). */
  seed(model: ModelName, data: Row): Row {
    return clone(this.insert(model, data, null));
  }

  rows(model: ModelName): Row[] {
    return clone(this.tables[model]);
  }

  row(model: ModelName, where: Where): Row | undefined {
    const found = this.tables[model].find((candidate) => this.matches(model, candidate, where));
    return found ? clone(found) : undefined;
  }

  /** Deep copy of every table, for before/after comparisons. */
  snapshot(): Record<ModelName, Row[]> {
    return clone(this.tables);
  }

  operationsFor(model: ModelName, operation?: string) {
    return this.operations.filter((entry) => entry.model === model && (!operation || entry.operation === operation));
  }

  private buildClient(context: TransactionContext | null): Record<string, any> {
    const client: Record<string, any> = {};
    for (const model of MODEL_NAMES) client[model] = this.buildDelegate(model, context);
    client.$queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => this.queryRaw(context, strings, values);
    if (!context) {
      // Like Prisma, only the root client can open a transaction.
      client.$transaction = (input: unknown, options?: unknown) => this.transaction(input, options);
    }
    return client;
  }

  private buildDelegate(model: ModelName, context: TransactionContext | null) {
    const run = <T>(operation: string, args: any, work: () => T): Promise<T> => {
      const entry: OperationRecord = { model, operation, args: clone(args ?? {}), transactionId: context?.id ?? null };
      this.operations.push(entry);
      return Promise.resolve().then(() => {
        this.beforeOperation?.(entry);
        return work();
      });
    };
    return {
      findUnique: (args: any) => run('findUnique', args, () => this.findOne(model, args)),
      findUniqueOrThrow: (args: any) => run('findUniqueOrThrow', args, () => this.findOneOrThrow(model, args)),
      findFirst: (args: any = {}) => run('findFirst', args, () => this.findOne(model, args)),
      findFirstOrThrow: (args: any = {}) => run('findFirstOrThrow', args, () => this.findOneOrThrow(model, args)),
      findMany: (args: any = {}) => run('findMany', args, () => this.findMany(model, args)),
      count: (args: any = {}) => run('count', args, () => this.filter(model, args.where).length),
      aggregate: (args: any) => run('aggregate', args, () => this.aggregate(model, args)),
      create: (args: any) => run('create', args, () => this.project(model, this.insert(model, args.data, context), args)),
      update: (args: any) => run('update', args, () => this.project(model, this.updateOne(model, args.where, args.data, context), args)),
      updateMany: (args: any) => run('updateMany', args, () => ({
        count: this.filter(model, args.where).map((row) => this.applyUpdate(model, row, args.data, context)).length,
      })),
      upsert: (args: any) => run('upsert', args, () => {
        const existing = this.filter(model, args.where)[0];
        const row = existing
          ? this.applyUpdate(model, existing, args.update, context)
          : this.insert(model, args.create, context);
        return this.project(model, row, args);
      }),
      delete: (args: any) => run('delete', args, () => this.project(model, this.remove(model, this.findOneOrThrowRow(model, args.where), context), args)),
      deleteMany: (args: any = {}) => run('deleteMany', args, () => ({
        count: this.filter(model, args.where).map((row) => this.remove(model, row, context)).length,
      })),
    };
  }

  private async queryRaw(context: TransactionContext | null, strings: TemplateStringsArray, values: unknown[]) {
    const sql = Array.from(strings).join('$?');
    this.rawQueries.push({ sql, values: clone(values), transactionId: context?.id ?? null });
    this.beforeRawQuery?.(sql, values);
    if (VOID_ADVISORY_LOCK_CALL.test(sql)) {
      if (!/\)\s*::\s*text\b/i.test(sql)) {
        throw new FakePrismaError('P2010', `Invalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`N/A\`. Message: \`${VOID_DESERIALIZATION_MESSAGE}\``, {
          code: 'N/A', message: VOID_DESERIALIZATION_MESSAGE,
        });
      }
      // Outside a transaction PostgreSQL releases the lock at statement end.
      if (context) await this.acquireLock(context, String(values[0]));
      return [{ lockResult: '' }];
    }
    if (/^\s*SELECT 1\s*$/i.test(sql)) return [{ '?column?': 1 }];
    throw new Error(`FakePrisma: unsupported raw query: ${sql}`);
  }

  private async acquireLock(context: TransactionContext, key: string) {
    if (context.heldLocks.has(key)) return; // advisory locks are re-entrant within a session
    const previous = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    this.lockTails.set(key, tail);
    await previous;
    this.lockEvents.push({ key, transactionId: context.id, event: 'acquired' });
    context.heldLocks.set(key, () => {
      this.lockEvents.push({ key, transactionId: context.id, event: 'released' });
      if (this.lockTails.get(key) === tail) this.lockTails.delete(key);
      release();
    });
  }

  private async transaction(input: unknown, options?: unknown) {
    if (Array.isArray(input)) return Promise.all(input);
    if (typeof input !== 'function') throw new Error('FakePrisma: $transaction expects an array or a callback');
    const context: TransactionContext = { id: this.nextTransactionId++, heldLocks: new Map(), undo: [] };
    const record: TransactionRecord = { id: context.id, options: clone(options ?? null), outcome: 'pending' };
    this.transactions.push(record);
    try {
      const result = await input(this.buildClient(context));
      record.outcome = 'committed';
      return result;
    } catch (error) {
      for (const undo of context.undo.reverse()) undo();
      record.outcome = 'rolled-back';
      throw error;
    } finally {
      for (const release of context.heldLocks.values()) release();
    }
  }

  private matches(model: ModelName, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    const config = MODEL_CONFIG[model];
    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === 'OR') return (condition as Where[]).some((part) => this.matches(model, row, part));
      if (key === 'AND') return ([] as Where[]).concat(condition).every((part) => this.matches(model, row, part));
      if (key === 'NOT') return !([] as Where[]).concat(condition).some((part) => this.matches(model, row, part));
      const compound = config.unique.find((fields) => fields.length > 1 && fields.join('_') === key);
      if (compound) return compound.every((field) => same(row[field], condition[field]));
      const relation = config.relations?.[key];
      if (relation) {
        if (relation.kind !== 'one') throw new Error(`FakePrisma: unsupported to-many filter "${model}.${key}"`);
        const related = this.tables[relation.model].find((candidate) => same(candidate[relation.references], row[relation.field]));
        return Boolean(related) && this.matches(relation.model, related!, condition);
      }
      return matchesField(row[key], condition);
    });
  }

  private filter(model: ModelName, where?: Where) {
    return this.tables[model].filter((row) => this.matches(model, row, where));
  }

  private sorted(rows: Row[], orderBy: any) {
    const orders = ([] as any[]).concat(orderBy ?? []);
    return [...rows].sort((left, right) => {
      for (const order of orders) {
        const [field, direction] = Object.entries(order)[0] as [string, 'asc' | 'desc'];
        const result = compare(left[field], right[field]);
        if (result !== 0) return direction === 'desc' ? -result : result;
      }
      return 0;
    });
  }

  private findMany(model: ModelName, args: any) {
    const rows = this.sorted(this.filter(model, args.where), args.orderBy);
    const sliced = args.take === undefined ? rows : rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
    return sliced.map((row) => this.project(model, row, args));
  }

  private findOne(model: ModelName, args: any) {
    const row = this.sorted(this.filter(model, args.where), args.orderBy)[0];
    return row ? this.project(model, row, args) : null;
  }

  private findOneOrThrowRow(model: ModelName, where: Where) {
    const row = this.filter(model, where)[0];
    if (!row) throw new FakePrismaError('P2025', `No ${model} record was found for the operation.`);
    return row;
  }

  private findOneOrThrow(model: ModelName, args: any) {
    return this.project(model, this.findOneOrThrowRow(model, args.where), args);
  }

  private aggregate(model: ModelName, args: any) {
    const rows = this.filter(model, args.where);
    const result: Row = {};
    if (args._count) {
      result._count = Object.fromEntries(Object.keys(args._count).map((field) => [
        field,
        field === '_all' ? rows.length : rows.filter((row) => row[field] !== null && row[field] !== undefined).length,
      ]));
    }
    if (args._sum) {
      result._sum = Object.fromEntries(Object.keys(args._sum).map((field) => [
        field,
        rows.length ? rows.reduce((total, row) => total + (row[field] ?? 0), 0) : null,
      ]));
    }
    for (const kind of ['_max', '_min'] as const) {
      if (!args[kind]) continue;
      result[kind] = Object.fromEntries(Object.keys(args[kind]).map((field) => {
        const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
        if (!values.length) return [field, null];
        const pick = values.reduce((best, value) => (kind === '_max' ? compare(value, best) > 0 : compare(value, best) < 0) ? value : best);
        return [field, clone(pick)];
      }));
    }
    return result;
  }

  private assertUnique(model: ModelName, candidate: Row, ignore?: Row) {
    for (const fields of MODEL_CONFIG[model].unique) {
      if (fields.some((field) => candidate[field] === null || candidate[field] === undefined)) continue;
      const clash = this.tables[model].some((row) => row !== ignore && fields.every((field) => same(row[field], candidate[field])));
      if (clash) {
        throw new FakePrismaError('P2002', `Unique constraint failed on the fields: (${fields.join(', ')})`, { target: fields });
      }
    }
  }

  private insert(model: ModelName, data: Row, context: TransactionContext | null) {
    const config = MODEL_CONFIG[model];
    const now = new Date();
    const row: Row = { id: randomUUID(), ...config.defaults(), createdAt: now, ...(config.updatedAt ? { updatedAt: now } : {}) };
    for (const [key, value] of Object.entries(data ?? {})) if (value !== undefined) row[key] = clone(value);
    this.assertUnique(model, row);
    this.tables[model].push(row);
    context?.undo.push(() => {
      const index = this.tables[model].indexOf(row);
      if (index >= 0) this.tables[model].splice(index, 1);
    });
    return row;
  }

  private applyUpdate(model: ModelName, row: Row, data: Row, context: TransactionContext | null) {
    const before = clone(row);
    const next: Row = { ...row };
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value === undefined) continue;
      if (isPlainObject(value) && ('increment' in value || 'decrement' in value || 'set' in value)) {
        if ('increment' in value) next[key] = (next[key] ?? 0) + value.increment;
        else if ('decrement' in value) next[key] = (next[key] ?? 0) - value.decrement;
        else next[key] = clone(value.set);
      } else {
        next[key] = clone(value);
      }
    }
    if (MODEL_CONFIG[model].updatedAt && !('updatedAt' in (data ?? {}))) next.updatedAt = new Date();
    this.assertUnique(model, next, row);
    Object.assign(row, next);
    context?.undo.push(() => {
      for (const key of Object.keys(row)) delete row[key];
      Object.assign(row, before);
    });
    return row;
  }

  private updateOne(model: ModelName, where: Where, data: Row, context: TransactionContext | null) {
    return this.applyUpdate(model, this.findOneOrThrowRow(model, where), data, context);
  }

  private remove(model: ModelName, row: Row, context: TransactionContext | null) {
    for (const cascade of MODEL_CONFIG[model].cascades ?? []) {
      const children = this.tables[cascade.model].filter((child) => same(child[cascade.field], row[cascade.references]));
      for (const child of children) this.remove(cascade.model, child, context);
    }
    const index = this.tables[model].indexOf(row);
    if (index >= 0) this.tables[model].splice(index, 1);
    context?.undo.push(() => { this.tables[model].splice(Math.min(index, this.tables[model].length), 0, row); });
    return row;
  }

  private related(model: ModelName, row: Row, name: string) {
    const relation = MODEL_CONFIG[model].relations?.[name];
    if (!relation) throw new Error(`FakePrisma: unknown relation "${model}.${name}"`);
    const matchesRow = (candidate: Row) => same(candidate[relation.references], row[relation.field]);
    return relation.kind === 'one'
      ? { relation, rows: this.tables[relation.model].filter(matchesRow).slice(0, 1) }
      : { relation, rows: this.tables[relation.model].filter(matchesRow) };
  }

  private project(model: ModelName, row: Row, args: any = {}): Row {
    const nested = (name: string, spec: any) => {
      const { relation, rows } = this.related(model, row, name);
      const nestedArgs = spec === true ? {} : spec;
      const projected = rows.map((candidate) => this.project(relation.model, candidate, nestedArgs));
      return relation.kind === 'one' ? projected[0] ?? null : projected;
    };
    if (args.select) {
      const out: Row = {};
      for (const [key, spec] of Object.entries(args.select)) {
        if (!spec) continue;
        if (key === '_count') {
          out._count = Object.fromEntries(Object.keys((spec as any).select).map((name) => [name, this.related(model, row, name).rows.length]));
        } else if (MODEL_CONFIG[model].relations?.[key]) {
          out[key] = nested(key, spec);
        } else {
          out[key] = clone(row[key]);
        }
      }
      return out;
    }
    const out = clone(row);
    for (const [key, spec] of Object.entries(args.include ?? {})) if (spec) out[key] = nested(key, spec);
    return out;
  }
}
