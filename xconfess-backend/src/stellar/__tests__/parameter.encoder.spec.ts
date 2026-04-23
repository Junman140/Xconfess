import * as StellarSDK from '@stellar/stellar-sdk';
import {
  encodeStringParam,
  encodeU64Param,
  encodeBytesParam,
  encodeBoolParam,
  encodeAddressParam,
  encodeVecParam,
  encodeMapParam,
  encodeContractArg,
  encodeContractArgs,
  type ContractArg,
} from '../utils/parameter.encoder';

/** Deterministic public key fixture (valid G-account) for stable XDR snapshots. */
const SAMPLE_PUBLIC_KEY =
  'GACRG7PJ62DGGUXXVA3XVTAAZGMFMHEIYNN7MUT56LBXC4WW6KKDOPM2';

function xdr64(v: StellarSDK.xdr.ScVal): string {
  return v.toXDR('base64');
}

describe('parameter.encoder — Soroban ScVal encoding regression', () => {
  it('encodes empty collections (vec/map) deterministically', () => {
    const emptyVec = encodeContractArg({ type: 'vec', value: [] });
    const emptyMap = encodeContractArg({ type: 'map', value: {} });

    expect(StellarSDK.scValToNative(emptyVec)).toEqual([]);
    expect(StellarSDK.scValToNative(emptyMap)).toEqual({});

    expect(xdr64(emptyVec)).toMatchInlineSnapshot(`"AAAAAQAAAAAAAAAA"`);
    expect(xdr64(emptyMap)).toMatchInlineSnapshot(`"AAAAAgAAAAAAAAAA"`);
  });

  it('encodes encodeContractArgs([]) as an empty ScVal list', () => {
    expect(encodeContractArgs([])).toEqual([]);
  });

  it('covers complex nested values (map -> vec -> map) with stable XDR', () => {
    const arg: ContractArg = {
      type: 'map',
      value: {
        outer: {
          type: 'vec',
          value: [
            { type: 'string', value: 'a' },
            {
              type: 'map',
              value: {
                nested: { type: 'u64', value: 42n },
                flag: { type: 'bool', value: true },
              },
            },
            { type: 'bytes', value: Buffer.from('deadbeef', 'hex') },
          ],
        },
      },
    };

    const scv = encodeContractArg(arg);
    const native = StellarSDK.scValToNative(scv) as Record<string, unknown[]>;
    expect(native.outer[0]).toBe('a');
    expect((native.outer[1] as { nested: { toString(): string } }).nested.toString()).toBe(
      '42',
    );
    expect((native.outer[1] as { flag: boolean }).flag).toBe(true);

    expect(xdr64(scv)).toMatchInlineSnapshot(
      `"AAAAAgAAAAEAAAACAAAAAQAAAAEAAAAGAAAAAW91dGVyAAAAAQAAAAEAAAABAAAABgAAAAFvdXRlcgAAAAACAAAAAwAAAAEAAAAGAAAAAWIAAAACAAAAAgAAAAEAAAAGAAAAAWZsYWcAAAAAAQAAAAEAAAABAAAABgAAAABuZXN0ZWQAAAAAAQAAAAAAAAAAKgAAAAEAAAADAAAABAAAAADe2+7v"`,
    );
  });

  it('encodes map + option(vec(address)) with stable XDR and native roundtrip', () => {
    const arg: ContractArg = {
      type: 'map',
      value: {
        meta: { type: 'string', value: 'x' },
        signer: {
          type: 'option',
          value: {
            type: 'vec',
            value: [{ type: 'address', value: SAMPLE_PUBLIC_KEY }],
          },
        },
      },
    };
    const once = encodeContractArg(arg);
    const twice = encodeContractArg(arg);
    expect(xdr64(once)).toBe(xdr64(twice));

    const native = StellarSDK.scValToNative(once) as {
      meta: string;
      signer: unknown[];
    };
    expect(native.meta).toBe('x');
    expect(native.signer).toHaveLength(1);
    const addrNode = native.signer[0];
    const addrStr =
      typeof addrNode === 'string'
        ? addrNode
        : (addrNode as StellarSDK.Address).toString();
    expect(addrStr).toBe(SAMPLE_PUBLIC_KEY);
  });

  it('encodes optionals: null -> scvVoid; some(value) -> encoded inner ScVal', () => {
    const none = encodeContractArg({ type: 'option', value: null });
    const some = encodeContractArg({
      type: 'option',
      value: { type: 'string', value: 'hello' },
    });

    expect(none.switch()).toBe(StellarSDK.xdr.ScValType.scvVoid());
    expect(xdr64(none)).toMatchInlineSnapshot(`"AAAAAA=="`);

    expect(StellarSDK.scValToNative(some)).toBe('hello');
    expect(xdr64(some)).toMatchInlineSnapshot(
      `"AAAAAQAAAAUAAAAGAAAABWhlbGxv"`,
    );
  });

  it('encodes nested option shapes (Some inner encodes to native)', () => {
    const someNone = encodeContractArg({
      type: 'option',
      value: { type: 'option', value: null },
    });
    expect(someNone.switch()).toBe(StellarSDK.xdr.ScValType.scvVoid());

    const someSome = encodeContractArg({
      type: 'option',
      value: {
        type: 'option',
        value: { type: 'string', value: 'nested' },
      },
    });
    expect(StellarSDK.scValToNative(someSome)).toBe('nested');
    expect(xdr64(someSome)).toBe(
      xdr64(encodeContractArg({ type: 'string', value: 'nested' })),
    );
  });

  it('sorts map keys to ensure stable XDR across insertion orders', () => {
    const aThenB = encodeContractArg({
      type: 'map',
      value: {
        a: { type: 'u64', value: 1 },
        b: { type: 'u64', value: 2 },
      },
    });

    const bThenA = encodeContractArg({
      type: 'map',
      value: {
        b: { type: 'u64', value: 2 },
        a: { type: 'u64', value: 1 },
      },
    });

    expect(xdr64(aThenB)).toBe(xdr64(bThenA));
  });

  it('encodes empty hex bytes string as empty ScVal bytes', () => {
    const scv = encodeContractArg({ type: 'bytes', value: '' });
    const native = StellarSDK.scValToNative(scv) as Buffer;
    expect(native.length).toBe(0);
    expect(xdr64(scv)).toBe(
      xdr64(encodeContractArg({ type: 'bytes', value: Buffer.alloc(0) })),
    );
  });

  it('produces stable validation errors for invalid bytes hex', () => {
    expect(() =>
      encodeContractArg({ type: 'bytes', value: 'abc' }),
    ).toThrow('Invalid hex bytes: length must be even');

    expect(() =>
      encodeContractArg({ type: 'bytes', value: 'zz' }),
    ).toThrow('Invalid hex bytes: non-hex characters present');
  });

  it('rejects invalid Stellar addresses when encoding', () => {
    expect(() =>
      encodeContractArg({ type: 'address', value: 'not-a-g-address' }),
    ).toThrow();
  });

  it('throws a stable error for unsupported arg types (guard rail)', () => {
    expect(() =>
      encodeContractArg({ type: 'nope', value: 1 } as unknown as ContractArg),
    ).toThrow('Unsupported contract arg type: nope');
  });

  it('encodes arrays of args and preserves ordering with nested optionals', () => {
    const args: ContractArg[] = [
      { type: 'string', value: 'first' },
      { type: 'option', value: null },
      { type: 'option', value: { type: 'u64', value: 9 } },
      {
        type: 'vec',
        value: [{ type: 'option', value: { type: 'bool', value: false } }],
      },
    ];

    const scvs = encodeContractArgs(args);
    expect(scvs).toHaveLength(4);
    expect(StellarSDK.scValToNative(scvs[0])).toBe('first');
    expect(scvs[1].switch()).toBe(StellarSDK.xdr.ScValType.scvVoid());
    expect(Number(StellarSDK.scValToNative(scvs[2]))).toBe(9);
    expect(StellarSDK.scValToNative(scvs[3])).toEqual([false]);
  });

  it('matches encodeVecParam / encodeMapParam XDR to encodeContractArg for the same payload', () => {
    const vecArg: ContractArg = {
      type: 'vec',
      value: [{ type: 'u64', value: 3n }],
    };
    expect(xdr64(encodeVecParam(vecArg.value))).toBe(xdr64(encodeContractArg(vecArg)));

    const mapArg: ContractArg = {
      type: 'map',
      value: { k: { type: 'bool', value: true } },
    };
    expect(xdr64(encodeMapParam(mapArg.value))).toBe(
      xdr64(encodeContractArg(mapArg)),
    );
  });

  it('passes raw ScVal through encodeContractArgs unchanged', () => {
    const raw = StellarSDK.nativeToScVal(99n, { type: 'u64' });
    const out = encodeContractArgs([raw]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(raw);
  });
});

describe('parameter.encoder — scalar helpers', () => {
  describe('encodeStringParam', () => {
    it('encodes a string to ScVal', () => {
      const val = encodeStringParam('hello');
      expect(StellarSDK.scValToNative(val)).toBe('hello');
    });
  });

  describe('encodeU64Param', () => {
    it('encodes a number to u64 ScVal', () => {
      const val = encodeU64Param(42);
      expect(Number(StellarSDK.scValToNative(val))).toBe(42);
    });

    it('encodes a bigint to u64 ScVal', () => {
      const val = encodeU64Param(BigInt('9007199254740993'));
      expect(StellarSDK.scValToNative(val)).toBe(BigInt('9007199254740993'));
    });
  });

  describe('encodeBytesParam', () => {
    it('encodes a Buffer', () => {
      const buf = Buffer.from('deadbeef', 'hex');
      const val = encodeBytesParam(buf);
      const native = StellarSDK.scValToNative(val) as Buffer;
      expect(Buffer.compare(native, buf)).toBe(0);
    });

    it('encodes a hex string', () => {
      const val = encodeBytesParam('deadbeef');
      const native = StellarSDK.scValToNative(val) as Buffer;
      expect(native.toString('hex')).toBe('deadbeef');
    });
  });

  describe('encodeBoolParam', () => {
    it('encodes true', () => {
      expect(StellarSDK.scValToNative(encodeBoolParam(true))).toBe(true);
    });
    it('encodes false', () => {
      expect(StellarSDK.scValToNative(encodeBoolParam(false))).toBe(false);
    });
  });

  describe('encodeAddressParam', () => {
    it('encodes a valid Stellar address', () => {
      const kp = StellarSDK.Keypair.random();
      const val = encodeAddressParam(kp.publicKey());
      const native = StellarSDK.scValToNative(val) as StellarSDK.Address;
      expect(native.toString()).toBe(kp.publicKey());
    });
  });

  describe('encodeVecParam', () => {
    it('encodes a vec of mixed scalar args', () => {
      const args: ContractArg[] = [
        { type: 'string', value: 'a' },
        { type: 'u64', value: 1 },
      ];
      const val = encodeVecParam(args);
      expect(val.switch().name).toBe('scvVec');
    });
  });

  describe('encodeMapParam', () => {
    it('encodes a map of string keys to scalar values', () => {
      const val = encodeMapParam({
        foo: { type: 'string', value: 'bar' },
        count: { type: 'u64', value: 7 },
      });
      expect(val.switch().name).toBe('scvMap');
      const entries = val.map();
      expect(entries).toHaveLength(2);
    });
  });

  describe('encodeContractArg', () => {
    it('passes through a raw ScVal unchanged', () => {
      const raw = StellarSDK.nativeToScVal('raw', { type: 'string' });
      expect(encodeContractArg(raw)).toBe(raw);
    });

    it('throws on an unknown type', () => {
      expect(() =>
        encodeContractArg({ type: 'unknown' as any, value: 'x' } as any),
      ).toThrow(/Unsupported contract arg type/);
    });
  });

  describe('encodeContractArgs — anchor_confession shape', () => {
    it('encodes the exact args used by anchorConfession()', () => {
      const hash =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const ts = 1_700_000_000;

      const args: ContractArg[] = [
        { type: 'bytes', value: Buffer.from(hash, 'hex') },
        { type: 'u64', value: ts },
      ];

      const [bytesVal, u64Val] = encodeContractArgs(args);

      const decodedBytes = StellarSDK.scValToNative(bytesVal) as Buffer;
      expect(decodedBytes.toString('hex')).toBe(hash);

      expect(Number(StellarSDK.scValToNative(u64Val))).toBe(ts);
    });
  });
});
