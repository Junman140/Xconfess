/**
 * parameter.encoder.ts
 *
 * Single authoritative Soroban ScVal encoding path for the xConfess backend.
 * ContractService delegates all argument encoding here — there is no duplicate
 * logic in contract.service.ts.
 *
 * Supported types
 * ───────────────
 *  • string   → ScVal string
 *  • u64      → ScVal u64  (JS number or bigint)
 *  • bool     → ScVal bool
 *  • bytes    → ScVal bytes  (Buffer or hex string)
 *  • address  → ScVal address  (Stellar G… public key)
 *  • map      → ScVal map  (Record<string, ContractArg>)
 *  • vec      → ScVal vec  (ContractArg[])
 *  • option   → None as ScVal::Void; Some(inner) as encoded inner
 *  • ScVal    → passed through unchanged
 */

import * as StellarSDK from '@stellar/stellar-sdk';

// ─── Guard rails (DoS / accidental huge payloads) ─────────────────────────

const ENCODING_LIMITS = {
  /** Max nesting of vec / map / option(Some) — avoids stack overflow. */
  maxNestingDepth: 48,
  /** Total typed nodes + ScVal leaves across one encodeContractArgs call. */
  maxTotalNodes: 8192,
  maxVecLength: 512,
  maxMapEntries: 256,
  maxStringUtf8Bytes: 65_535,
} as const;

// ─── Public types ────────────────────────────────────────────────────────────

export type ScalarContractArg =
  | { type: 'string'; value: string }
  | { type: 'u64'; value: number | bigint }
  | { type: 'bool'; value: boolean }
  | { type: 'bytes'; value: Buffer | string }
  | { type: 'address'; value: string };

export type ComplexContractArg =
  | { type: 'map'; value: Record<string, ContractArg> }
  | { type: 'vec'; value: ContractArg[] }
  /**
   * Soroban option encoding.
   * `null` encodes to `ScVal::Void` (None); otherwise encodes the inner value.
   */
  | { type: 'option'; value: ContractArg | null };

/** A fully-typed contract argument. Pass raw ScVal to skip encoding. */
export type ContractArg =
  | ScalarContractArg
  | ComplexContractArg
  | StellarSDK.xdr.ScVal;

type EncodeCtx = {
  nestingDepth: number;
  nodeCount: number;
  /** Composite `ContractArg` objects on the current recursion path (cycle detect). */
  visiting: WeakSet<object>;
};

function createEncodeCtx(): EncodeCtx {
  return {
    nestingDepth: 0,
    nodeCount: 0,
    visiting: new WeakSet<object>(),
  };
}

function bumpNodeCount(ctx: EncodeCtx): void {
  ctx.nodeCount += 1;
  if (ctx.nodeCount > ENCODING_LIMITS.maxTotalNodes) {
    throw new Error(
      `Contract arg encoding exceeded maximum node count (${ENCODING_LIMITS.maxTotalNodes})`,
    );
  }
}

function assertNestingDepth(ctx: EncodeCtx): void {
  if (ctx.nestingDepth > ENCODING_LIMITS.maxNestingDepth) {
    throw new Error(
      `Contract arg nesting exceeds maximum depth (${ENCODING_LIMITS.maxNestingDepth})`,
    );
  }
}

function assertU64InRange(val: number | bigint): void {
  const max = (1n << 64n) - 1n;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || !Number.isInteger(val) || val < 0) {
      throw new Error('Invalid u64: expected a non-negative integer');
    }
  }
  let asBig: bigint;
  try {
    asBig = BigInt(val);
  } catch {
    throw new Error('Invalid u64: value is not an integer');
  }
  if (asBig < 0n || asBig > max) {
    throw new Error('Invalid u64: out of uint64 range');
  }
}

function assertStringSize(val: string): void {
  const len = Buffer.byteLength(val, 'utf8');
  if (len > ENCODING_LIMITS.maxStringUtf8Bytes) {
    throw new Error(
      `Invalid string: exceeds maximum UTF-8 length (${ENCODING_LIMITS.maxStringUtf8Bytes} bytes)`,
    );
  }
}

function isTypedContractArg(x: unknown): x is Exclude<ContractArg, StellarSDK.xdr.ScVal> {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    typeof (x as { type: unknown }).type === 'string'
  );
}

// ─── Scalar helpers (exported for direct use & tests) ────────────────────────

export function encodeStringParam(val: string): StellarSDK.xdr.ScVal {
  assertStringSize(val);
  return StellarSDK.nativeToScVal(val, { type: 'string' });
}

export function encodeU64Param(val: number | bigint): StellarSDK.xdr.ScVal {
  assertU64InRange(val);
  return StellarSDK.nativeToScVal(val, { type: 'u64' });
}

export function encodeBytesParam(val: Buffer | string): StellarSDK.xdr.ScVal {
  if (typeof val === 'string') {
    if (val.length % 2 !== 0) {
      throw new Error('Invalid hex bytes: length must be even');
    }
    if (!/^[0-9a-fA-F]*$/.test(val)) {
      throw new Error('Invalid hex bytes: non-hex characters present');
    }
  }
  const buf = typeof val === 'string' ? Buffer.from(val, 'hex') : val;
  return StellarSDK.nativeToScVal(buf, { type: 'bytes' });
}

export function encodeBoolParam(val: boolean): StellarSDK.xdr.ScVal {
  return StellarSDK.nativeToScVal(val, { type: 'bool' });
}

export function encodeAddressParam(val: string): StellarSDK.xdr.ScVal {
  try {
    return StellarSDK.nativeToScVal(new StellarSDK.Address(val), {
      type: 'address',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid Stellar address: ${msg}`);
  }
}

// ─── Complex helpers ─────────────────────────────────────────────────────────

/** Encode a vec using the same limits and cycle detection as {@link encodeContractArg}. */
export function encodeVecParam(items: ContractArg[]): StellarSDK.xdr.ScVal {
  return encodeContractArg({ type: 'vec', value: items });
}

/** Encode a map using the same limits and cycle detection as {@link encodeContractArg}. */
export function encodeMapParam(
  entries: Record<string, ContractArg>,
): StellarSDK.xdr.ScVal {
  return encodeContractArg({ type: 'map', value: entries });
}

// ─── Primary encoding entry-point ────────────────────────────────────────────

/**
 * Encode a single ContractArg to an ScVal.
 * Raw ScVal objects are passed through unchanged so callers that already hold
 * an ScVal (e.g. anchorConfession) don't need to unwrap/re-wrap them.
 */
export function encodeContractArg(arg: ContractArg): StellarSDK.xdr.ScVal {
  return encodeContractArgWithCtx(arg, createEncodeCtx());
}

function encodeContractArgWithCtx(
  arg: ContractArg,
  ctx: EncodeCtx,
): StellarSDK.xdr.ScVal {
  // Already an ScVal — pass through.
  if (arg instanceof StellarSDK.xdr.ScVal) {
    bumpNodeCount(ctx);
    return arg;
  }

  if (!isTypedContractArg(arg)) {
    throw new Error('Invalid contract arg: expected typed ContractArg or ScVal');
  }

  const composite =
    arg.type === 'vec' ||
    arg.type === 'map' ||
    (arg.type === 'option' && arg.value !== null);

  if (composite) {
    if (ctx.visiting.has(arg)) {
      throw new Error('Circular contract arg reference');
    }
    ctx.visiting.add(arg);
    ctx.nestingDepth += 1;
    assertNestingDepth(ctx);
    try {
      return encodeTypedArgBody(arg, ctx);
    } finally {
      ctx.nestingDepth -= 1;
      ctx.visiting.delete(arg);
    }
  }

  return encodeTypedArgBody(arg, ctx);
}

function encodeTypedArgBody(
  arg: Exclude<ContractArg, StellarSDK.xdr.ScVal>,
  ctx: EncodeCtx,
): StellarSDK.xdr.ScVal {
  bumpNodeCount(ctx);

  switch (arg.type) {
    case 'string':
      assertStringSize(arg.value);
      return StellarSDK.nativeToScVal(arg.value, { type: 'string' });
    case 'u64':
      assertU64InRange(arg.value);
      return StellarSDK.nativeToScVal(arg.value, { type: 'u64' });
    case 'bool':
      return StellarSDK.nativeToScVal(arg.value, { type: 'bool' });
    case 'bytes':
      return encodeBytesParam(arg.value);
    case 'address':
      return encodeAddressParam(arg.value);
    case 'vec': {
      const items = arg.value;
      if (!Array.isArray(items)) {
        throw new Error('Invalid vec: value must be an array');
      }
      if (items.length > ENCODING_LIMITS.maxVecLength) {
        throw new Error(
          `Invalid vec: length exceeds maximum (${ENCODING_LIMITS.maxVecLength})`,
        );
      }
      return StellarSDK.xdr.ScVal.scvVec(
        items.map((item) => encodeContractArgWithCtx(item, ctx)),
      );
    }
    case 'map': {
      const entries = arg.value;
      if (
        entries === null ||
        typeof entries !== 'object' ||
        Array.isArray(entries)
      ) {
        throw new Error('Invalid map: value must be a plain object');
      }
      const keys = Object.keys(entries);
      if (keys.length > ENCODING_LIMITS.maxMapEntries) {
        throw new Error(
          `Invalid map: entry count exceeds maximum (${ENCODING_LIMITS.maxMapEntries})`,
        );
      }
      const mapEntries = keys
        .sort((a, b) => a.localeCompare(b))
        .map((k) => {
          assertStringSize(k);
          return new StellarSDK.xdr.ScMapEntry({
            key: encodeStringParam(k),
            val: encodeContractArgWithCtx(entries[k]!, ctx),
          });
        });
      return StellarSDK.xdr.ScVal.scvMap(mapEntries);
    }
    case 'option':
      return arg.value === null
        ? StellarSDK.xdr.ScVal.scvVoid()
        : encodeContractArgWithCtx(arg.value, ctx);
    default: {
      const u = arg as unknown as { type?: string };
      throw new Error(
        `Unsupported contract arg type: ${String(u.type ?? 'unknown')}`,
      );
    }
  }
}

/**
 * Encode an array of ContractArgs — the shape ContractService passes to
 * contract.call().
 */
export function encodeContractArgs(
  args: ContractArg[],
): StellarSDK.xdr.ScVal[] {
  if (!Array.isArray(args)) {
    throw new Error('Invalid contract args: expected an array');
  }
  const ctx = createEncodeCtx();
  return args.map((a) => encodeContractArgWithCtx(a, ctx));
}
