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
import { emptyBoard } from '@/lib/words-engine'
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

// A catalogue whose every value differs from the English source, so a label
// that bypasses it shows.
beforeAll(() => {
  i18n.load('xx', {
    [id('TW', 'triple word square')]: 'MT',
    [id('DW', 'double word square')]: 'MD',
    [id('TL', 'triple letter square')]: 'LT',
    [id('DL', 'double letter square')]: 'LD',
    [id('+{points}')]: '{points} more',
  })
  i18n.activate('xx')
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
