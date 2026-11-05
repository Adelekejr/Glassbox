const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bitcoin/NEAR base58. Leading zero bytes become leading "1"s. */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeroes = 0;
  let begin = 0;
  const end = bytes.length;
  while (begin < end && bytes[begin] === 0) {
    begin += 1;
    zeroes += 1;
  }
  const size = Math.ceil(((end - begin) * 138) / 100) + 1;
  const encoded = new Uint8Array(size);
  let length = 0;
  while (begin < end) {
    let carry = bytes[begin] ?? 0;
    let index = 0;
    for (let cursor = size - 1; (carry !== 0 || index < length) && cursor >= 0; cursor -= 1, index += 1) {
      carry += 256 * (encoded[cursor] ?? 0);
      encoded[cursor] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = index;
    begin += 1;
  }
  let cursor = size - length;
  while (cursor < size && encoded[cursor] === 0) cursor += 1;
  let out = "1".repeat(zeroes);
  for (; cursor < size; cursor += 1) out += ALPHABET[encoded[cursor] ?? 0];
  return out;
}
