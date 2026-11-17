// QR Model 2, version 6, error correction L, byte mode, mask 0.
// 2 blocks x (68 data + 18 Reed–Solomon parity); 134 UTF-8 bytes maximum.
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 134)
    throw Error(
      "Pairing URL too long for QR. Use a shorter public hostname or manual room code.",
    );
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, 1088 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let i = 0; data.length < 136; i++) data.push(i % 2 ? 0x11 : 0xec);
  const mul = (a: number, b: number) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((b >>> i) & 1) * a;
    }
    return z;
  };
  let gen = [1],
    root = 1;
  for (let i = 0; i < 18; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], root);
    }
    gen = next;
    root = mul(root, 2);
  }
  const blocks = [data.slice(0, 68), data.slice(68)],
    parity = blocks.map((block) => {
      const rem = new Array(18).fill(0);
      for (const b of block) {
        const factor = b ^ rem.shift()!;
        rem.push(0);
        for (let j = 0; j < 18; j++) rem[j] ^= mul(gen[j + 1], factor);
      }
      return rem;
    });
  const words: number[] = [];
  for (let i = 0; i < 68; i++) for (const b of blocks) words.push(b[i]);
  for (let i = 0; i < 18; i++) for (const p of parity) words.push(p[i]);
  const n = 41,
    m = Array.from({ length: n }, () => Array(n).fill(false)),
    reserved = Array.from({ length: n }, () => Array(n).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    if (x >= 0 && y >= 0 && x < n && y < n) {
      m[y][x] = on;
      reserved[y][x] = true;
    }
  };
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      set(34 + dx, 34 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  const format = (value: number) => {
    const bit = (i: number) => !!((value >>> i) & 1);
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true);
  };
  format(0);
  let idx = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      const y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (reserved[y][x]) continue;
        const v =
          idx < words.length * 8
            ? (words[idx >>> 3] >>> (7 - (idx & 7))) & 1
            : 0;
        idx++;
        m[y][x] = !!(v ^ ((x + y) % 2 === 0 ? 1 : 0));
      }
    }
  }
  let rem = 8;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  format(((8 << 10) | rem) ^ 0x5412);
  return m;
}
export function drawQR(canvas: HTMLCanvasElement, text: string) {
  const m = qrMatrix(text),
    scale = 5;
  canvas.width = canvas.height = (m.length + 8) * scale;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#fff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#102e38";
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m.length; x++)
      if (m[y][x]) c.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
}
