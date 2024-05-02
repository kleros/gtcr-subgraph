import {
  BigInt,
  Bytes,
  JSONValue,
  JSONValueKind,
} from '@graphprotocol/graph-ts';

/**
 * @description extracts the cid from ipfs strings starting with "/", "/ipfs", "ipfs/", or "ipfs::/"
 * @param inputString the ipfs string
 * @returns returns the cid with path to file
 */
export function extractPath(inputString: string): string {
  if (inputString.startsWith('ipfs/')) return inputString.replace('ipfs/', '');

  if (inputString.startsWith('/ipfs/'))
    return inputString.replace('/ipfs/', '');

  if (inputString.startsWith('/')) return inputString.replace('/', '');

  if (inputString.startsWith('ipfs::/'))
    return inputString.replace('ipfs::/', '');

  return inputString;
}

export const ZERO_ADDRESS = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000',
) as Bytes;

export function JSONValueToMaybeString(
  value: JSONValue | null,
  _default: string = '-',
): string {
  // Subgraph considers an empty string to be null and
  // the handler crashes when attempting to save the entity.
  // This is a security vulnerability because an adversary
  // could manually craft an item with missing columns
  // and the item would not show up in the UI, passing
  // the challenge period unoticed.
  //
  // We fix this by setting the field manually to a hifen.
  if (value == null || value.isNull()) {
    return '-';
  }

  switch (value.kind) {
    case JSONValueKind.BOOL:
      return value.toBool() == true ? 'true' : 'false';
    case JSONValueKind.STRING:
      return value.toString();
    case JSONValueKind.NUMBER:
      return value.toBigInt().toHexString();
    default:
      return _default;
  }
}

export function JSONValueToBool(
  value: JSONValue | null,
  _default: boolean = false,
): boolean {
  if (value == null || value.isNull()) {
    return _default;
  }

  switch (value.kind) {
    case JSONValueKind.BOOL:
      return value.toBool();
    case JSONValueKind.STRING:
      return value.toString() == 'true';
    case JSONValueKind.NUMBER:
      return value.toBigInt().notEqual(BigInt.fromString('0'));
    default:
      return _default;
  }
}
