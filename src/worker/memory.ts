import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * OptMem-semantics memory, reimplemented in TypeScript.
 *
 * Layout (OptMem-compatible):
 *   <dir>/LOG.txt        one memory per line, append-only, line number = id
 *   <dir>/TREE/<lo>-<hi>.txt   one-line summary covering log lines [lo, hi]
 *
 * The summary tree is over aligned dyadic intervals: node lo-hi (size 2^k)
 * covers children lo-mid and mid+1-hi; leaves cover two raw lines.
 * A merge becomes due when a node's two halves exist but the node does not.
 * Merges are offered one at a time, in the result of `note`, like OptMem.
 */

export interface MergeDue {
  lo: number;
  hi: number;
  /** The text the model should compress: children summaries, or raw lines for leaves. */
  source: string;
}

export class MemoryStore {
  readonly dir: string;
  private readonly treeDir: string;
  private readonly logPath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.treeDir = join(dir, 'TREE');
    this.logPath = join(dir, 'LOG.txt');
    mkdirSync(this.treeDir, { recursive: true });
  }

  log(): string[] {
    if (!existsSync(this.logPath)) return [];
    const text = readFileSync(this.logPath, 'utf8');
    if (text === '') return [];
    return text.endsWith('\n')
      ? text.slice(0, -1).split('\n')
      : text.split('\n');
  }

  private nodePath(lo: number, hi: number): string {
    return join(this.treeDir, `${lo}-${hi}.txt`);
  }

  private hasNode(lo: number, hi: number): boolean {
    return existsSync(this.nodePath(lo, hi));
  }

  private nodeText(lo: number, hi: number): string | undefined {
    const p = this.nodePath(lo, hi);
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : undefined;
  }

  /** Append one memory line. Returns the merge now due, if any. */
  note(text: string, at?: Date): MergeDue | null {
    const stamp = (at ?? new Date())
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ');
    const body = text.replace(/\s+/g, ' ').trim().slice(0, 280);
    if (body === '') throw new Error('empty memory');
    appendFileSync(this.logPath, `${stamp} ${body}\n`, 'utf8');
    return this.nextMerge();
  }

  /** Store a summary for node lo-hi; the agent writes `summary`, we own the file. */
  nap(lo: number, hi: number, summary: string): MergeDue | null {
    if (hi - lo < 1 || lo < 0) throw new Error(`bad node ${lo}-${hi}`);
    const size = hi - lo + 1;
    if ((size & (size - 1)) !== 0 || lo % size !== 0)
      throw new Error(`unaligned node ${lo}-${hi}`);
    const lines = this.log();
    if (hi >= lines.length && size === 2)
      throw new Error(`node ${lo}-${hi} covers missing lines`);
    writeFileSync(
      this.nodePath(lo, hi),
      summary.replace(/\s+/g, ' ').trim() + '\n',
      'utf8',
    );
    return this.nextMerge();
  }

  forget(lo: number, hi: number): void {
    const p = this.nodePath(lo, hi);
    if (existsSync(p)) unlinkSync(p);
  }

  /** The earliest pending merge, or null. Smallest intervals first, left to right. */
  nextMerge(): MergeDue | null {
    const n = this.log().length;
    for (let size = 2; size <= Math.max(n, 2); size *= 2) {
      for (let lo = 0; lo + size <= n; lo += size) {
        const hi = lo + size - 1;
        if (this.hasNode(lo, hi)) continue;
        if (size === 2) return { lo, hi, source: this.mergeSource(lo, hi) };
        const mid = lo + size / 2 - 1;
        if (this.hasNode(lo, mid) && this.hasNode(mid + 1, hi)) {
          return { lo, hi, source: this.mergeSource(lo, hi) };
        }
      }
    }
    return null;
  }

  pendingMergeCount(): number {
    let count = 0;
    const n = this.log().length;
    for (let size = 2; size <= Math.max(n, 2); size *= 2) {
      for (let lo = 0; lo + size <= n; lo += size) {
        const hi = lo + size - 1;
        if (this.hasNode(lo, hi)) continue;
        if (
          size === 2 ||
          (this.hasNode(lo, lo + size / 2 - 1) &&
            this.hasNode(lo + size / 2, hi))
        )
          count++;
      }
    }
    return count;
  }

  /** The text a merge would compress: the two halves' summaries, or raw lines for a leaf. */
  private mergeSource(lo: number, hi: number): string {
    const lines = this.log();
    const mid = lo + (hi - lo + 1) / 2 - 1;
    const half = (a: number, b: number): string => {
      const node = this.nodeText(a, b);
      if (node !== undefined) return `#${a}-${b} ${node}`;
      return lines
        .slice(a, Math.min(b, lines.length - 1) + 1)
        .map((l, i) => `#${a + i} ${l}`)
        .join('\n');
    };
    return `${half(lo, mid)}\n${half(mid + 1, hi)}`;
  }

  /**
   * What wake prints: coarse summary nodes covering old history, then raw
   * unmerged tail lines, oldest to newest, capped at `budget` lines.
   */
  wake(budget = 96): string {
    const lines = this.log();
    if (lines.length === 0) return '(no memories yet)';
    const items: string[] = [];
    let pos = 0;
    while (pos < lines.length) {
      const node = this.largestNodeAt(pos, lines.length);
      if (node) {
        items.push(
          `#${node.lo}-${node.hi} ${this.nodeText(node.lo, node.hi) ?? ''}`,
        );
        pos = node.hi + 1;
      } else {
        items.push(`#${pos} ${lines[pos]}`);
        pos += 1;
      }
    }
    if (items.length <= budget) return items.join('\n');
    const head = items.slice(0, Math.ceil(budget / 4));
    const tail = items.slice(-(budget - head.length - 1));
    return [
      ...head,
      `… (${items.length - head.length - tail.length} older lines omitted; use recall/zoom)`,
      ...tail,
    ].join('\n');
  }

  /** Largest existing summary node starting exactly at `pos`, or null. */
  private largestNodeAt(
    pos: number,
    n: number,
  ): { lo: number; hi: number } | null {
    const maxByAlign = pos === 0 ? 1 << 30 : pos & -pos; // largest pow2 dividing pos
    for (
      let size = Math.min(maxByAlign, highestPow2(n - pos));
      size >= 2;
      size /= 2
    ) {
      if (pos % size !== 0) continue;
      if (pos + size > n) continue;
      if (this.hasNode(pos, pos + size - 1))
        return { lo: pos, hi: pos + size - 1 };
    }
    return null;
  }

  recall(pattern: string, limit = 100): string {
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      throw new Error(`bad regex: ${pattern}`);
    }
    const hits: string[] = [];
    const lines = this.log();
    for (let i = 0; i < lines.length && hits.length < limit; i++) {
      if (re.test(lines[i])) hits.push(`#${i} ${lines[i]}`);
    }
    return hits.length === 0 ? '(no matches)' : hits.join('\n');
  }

  /** Open node lo-hi into its two halves: summaries where built, raw lines otherwise. */
  zoom(lo: number, hi: number): string {
    const lines = this.log();
    if (lo < 0 || hi >= lines.length || hi - lo < 1)
      throw new Error(`bad range ${lo}-${hi}`);
    const mid = lo + (hi - lo + 1) / 2 - 1;
    const half = (a: number, b: number): string => {
      const node = this.nodeText(a, b);
      if (node !== undefined) return `#${a}-${b} ${node}`;
      return lines
        .slice(a, Math.min(b, lines.length - 1) + 1)
        .map((l, i) => `#${a + i} ${l}`)
        .join('\n');
    };
    return `${half(lo, mid)}\n${half(mid + 1, hi)}`;
  }

  /** Dump for the read-only UI: line count, pending merges, then all lines. */
  dump(): { lines: string[]; pendingMerges: number } {
    return { lines: this.log(), pendingMerges: this.pendingMergeCount() };
  }
}

function highestPow2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}
