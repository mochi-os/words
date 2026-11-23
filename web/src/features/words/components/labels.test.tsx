// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import type { ReactNode } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BOARD_SIZE,
  emptyBoard,
  getPremium,
  type PremiumType,
} from '@/lib/words-engine'
import { useScoreGain } from '../lib/score'
import { WordsBoard } from './words-board'

// The two helpers these components use, without the rest of the library,
// which needs a DOM.
vi.mock('@mochi/web', async () => ({
  ...(await import('@mochi/web/lib/utils.ts')),
  ...(await import('@mochi/web/hooks/use-format.ts')),
}))

// The id Lingui's macro gives a message (as @lingui/message-utils computes
// it), so the catalogue below names its entries without a macro of its own,
// which extraction would pick up.
function id(message: string, context = ''): string {
  return createHash('sha256')
    .update(message + '\u001F' + context)
    .digest('base64')
    .slice(0, 6)
}

// The premium squares' full names in the catalogue below.
const NAMES: Record<Exclude<PremiumType, '.'>, string> = {
  TW: '~triple word',
  DW: '~double word',
  TL: '~triple letter',
  DL: '~double letter',
  ST: '~start, double word',
}

// A catalogue whose every value differs from the English source, so a label
// that bypasses it shows.
beforeAll(() => {
  i18n.load('xx', {
    [id('TW', 'triple word square')]: 'MT',
    [id('DW', 'double word square')]: 'MD',
    [id('TL', 'triple letter square')]: 'LT',
    [id('DL', 'double letter square')]: 'LD',
    [id('Triple word score', 'premium square')]: NAMES.TW,
    [id('Double word score', 'premium square')]: NAMES.DW,
    [id('Triple letter score', 'premium square')]: NAMES.TL,
    [id('Double letter score', 'premium square')]: NAMES.DL,
    [id('Start square, double word score', 'premium square')]: NAMES.ST,
    [id('Empty square {0}{1}')]: '~empty {0}{1}',
    [id('Empty square {0}{1}, {premiumName}')]: '~empty {0}{1}: {premiumName}',
    [id('{displayLetter} at {0}{1}')]: '~{displayLetter} on {0}{1}',
    [id('{0} at {1}{2}, click to remove')]: '~{0} on {1}{2}, remove',
    [id('{0} at {1}{2}, {premiumName}, click to remove')]:
      '~{0} on {1}{2}: {premiumName}, remove',
    [id('+{points}')]: '{points} more',
  })
  i18n.activate('xx')
})

// Each square's accessible name, row by row. A square without one is left
// out, so a board that names every square gives 225.
function squareLabels(html: string): string[] {
  return [
    ...html.matchAll(/<div role="gridcell"[^>]*? aria-label="([^"]*)"/g),
  ].map((match) => match[1])
}

function coordinate(row: number, col: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`
}

describe('the squares’ accessible names', () => {
  it('give every empty square its coordinate and its premium', () => {
    const html = markup(
      <WordsBoard
        board={emptyBoard()}
        pendingPlacements={[]}
        selectedRackIndex={null}
        isMyTurn={false}
        gameStatus='active'
        onCellClick={() => undefined}
        onRemovePlacement={() => undefined}
      />
    )
    const expected: string[] = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const premium = getPremium(row, col)
        expected.push(
          premium === '.'
            ? `~empty ${coordinate(row, col)}`
            : `~empty ${coordinate(row, col)}: ${NAMES[premium]}`
        )
      }
    }
    expect(squareLabels(html)).toEqual(expected)
  })

  it('name the premium under a tile of this move, not under a played one', () => {
    const board = emptyBoard()
    board[7][7] = 'A'
    const html = markup(
      <WordsBoard
        board={board}
        pendingPlacements={[
          { row: 0, col: 0, letter: 'B', rackTile: 'B' },
          { row: 0, col: 1, letter: 'C', rackTile: 'C' },
        ]}
        selectedRackIndex={null}
        isMyTurn
        gameStatus='active'
        onCellClick={() => undefined}
        onRemovePlacement={() => undefined}
      />
    )
    const labels = squareLabels(html)
    expect(labels).toHaveLength(BOARD_SIZE * BOARD_SIZE)
    // A1 is a triple word square, B1 a plain one, H8 the start square.
    expect(labels[0]).toBe(`~B on A1: ${NAMES.TW}, remove`)
    expect(labels[1]).toBe('~C on B1, remove')
    expect(labels[7 * BOARD_SIZE + 7]).toBe('~A on H8')
  })
})

function markup(node: ReactNode): string {
  return renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>)
}

describe('the premium squares', () => {
  it('are labelled in the viewer’s language', () => {
    const html = markup(
      <WordsBoard
        board={emptyBoard()}
        pendingPlacements={[]}
        selectedRackIndex={null}
        isMyTurn={false}
        gameStatus='active'
        onCellClick={() => undefined}
        onRemovePlacement={() => undefined}
      />
    )
    for (const label of ['MT', 'MD', 'LT', 'LD']) {
      expect(html).toContain(`>${label}<`)
    }
    for (const label of ['TW', 'DW', 'TL', 'DL']) {
      expect(html).not.toContain(`>${label}<`)
    }
  })
})

describe('a score gain', () => {
  function Gain({ score }: { score: number }) {
    return <span>{useScoreGain()(score)}</span>
  }

  it('is placed by the language and formatted as the user writes numbers', () => {
    expect(markup(<Gain score={1234} />)).toBe('<span>1,234 more</span>')
  })
})
