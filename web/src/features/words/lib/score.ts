// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback } from 'react'
import { useLingui } from '@lingui/react/macro'
import { useFormat } from '@mochi/web'

/**
 * The points a play gains, as "+12": the number in the user's own format and
 * the sign where the language puts it.
 */
export function useScoreGain(): (score: number) => string {
  const { t } = useLingui()
  const { formatNumber } = useFormat()
  return useCallback(
    (score: number) => {
      const points = formatNumber(score)
      return t`+${points}`
    },
    [t, formatNumber]
  )
}
