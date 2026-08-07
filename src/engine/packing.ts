import type { CutList } from './cutlist'

export interface StockLength {
  /** Board length in working units. */
  length: number
  label: string
}

export interface PackedCut {
  typeId: number
  label: string
  length: number
}

export interface PackedBoard {
  stockLength: number
  stockLabel: string
  cuts: PackedCut[]
  used: number
  waste: number
}

export interface PackingResult {
  boards: PackedBoard[]
  boardCounts: { stockLabel: string; stockLength: number; count: number }[]
  totalStock: number
  totalUsed: number
  totalWaste: number
  wasteFraction: number
  /** Cuts longer than the longest stock — cannot be fabricated from stock. */
  unplaceable: PackedCut[]
}

export interface PackingOptions {
  /** Saw kerf consumed per cut, working units. */
  kerf: number
  stock: StockLength[]
}

/**
 * First-fit-decreasing bin packing of the cut list into available stock.
 * After packing, each board is downsized to the smallest stock length that
 * still holds its cuts, which is what a builder buying lumber would do.
 */
export function packCuts(cutList: CutList, opts: PackingOptions): PackingResult {
  const stock = opts.stock.slice().sort((a, b) => a.length - b.length)
  if (stock.length === 0) {
    return {
      boards: [], boardCounts: [], totalStock: 0, totalUsed: 0,
      totalWaste: 0, wasteFraction: 0, unplaceable: [],
    }
  }
  const longest = stock[stock.length - 1]

  const cuts: PackedCut[] = []
  for (const row of cutList.rows) {
    for (let i = 0; i < row.quantity; i++) {
      cuts.push({ typeId: row.typeId, label: row.label, length: row.roundedCutLength })
    }
  }
  cuts.sort((a, b) => b.length - a.length)

  interface OpenBoard extends PackedBoard { remaining: number }
  const boards: OpenBoard[] = []
  const unplaceable: PackedCut[] = []

  for (const cut of cuts) {
    const need = cut.length + opts.kerf
    if (cut.length > longest.length) {
      unplaceable.push(cut)
      continue
    }
    let board = boards.find((b) => b.remaining >= need)
    if (!board) {
      // Open the longest stock; it gets downsized after packing.
      board = {
        stockLength: longest.length,
        stockLabel: longest.label,
        cuts: [],
        used: 0,
        waste: 0,
        remaining: longest.length,
      }
      boards.push(board)
    }
    board.cuts.push(cut)
    board.used += cut.length
    board.remaining -= need
  }

  for (const board of boards) {
    const needed = board.used + opts.kerf * board.cuts.length
    const smallest = stock.find((s) => s.length >= needed) ?? longest
    board.stockLength = smallest.length
    board.stockLabel = smallest.label
    board.waste = smallest.length - board.used
  }

  const totalStock = boards.reduce((n, b) => n + b.stockLength, 0)
  const totalUsed = boards.reduce((n, b) => n + b.used, 0)
  const countMap = new Map<string, { stockLabel: string; stockLength: number; count: number }>()
  for (const b of boards) {
    const entry = countMap.get(b.stockLabel) ?? { stockLabel: b.stockLabel, stockLength: b.stockLength, count: 0 }
    entry.count++
    countMap.set(b.stockLabel, entry)
  }
  return {
    boards: boards
      .map(({ remaining: _r, ...b }) => b)
      .sort((a, b) => b.stockLength - a.stockLength),
    boardCounts: [...countMap.values()].sort((a, b) => b.stockLength - a.stockLength),
    totalStock,
    totalUsed,
    totalWaste: totalStock - totalUsed,
    wasteFraction: totalStock > 0 ? (totalStock - totalUsed) / totalStock : 0,
    unplaceable,
  }
}
