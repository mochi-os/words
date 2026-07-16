// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import {
  Badge,
  Button,
  cn,
} from '@mochi/web'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react'
import type {
  DraftWordValidationState,
  MoveDraftStatus,
} from '../lib/move-draft'

interface DraftWordPreview {
  word: string
  score: number
}

interface MoveComposerProps {
  isMyTurn: boolean
  draftStatus: MoveDraftStatus
  totalScore: number
  words: readonly DraftWordPreview[]
  wordValidationState: Readonly<Record<string, DraftWordValidationState>>
  localErrorMessage: string | null
  validationUnavailable: boolean
  showMoveActions: boolean
  canRecall: boolean
  canSubmit: boolean
  isSubmitting: boolean
  onRecall: () => void
  onSubmit: () => void
  showExchangeActions: boolean
  exchangeCount: number
  isExchanging: boolean
  onCancelExchange: () => void
  onConfirmExchange: () => void
}

export function MoveComposer({
  isMyTurn,
  draftStatus,
  totalScore,
  words,
  wordValidationState,
  localErrorMessage,
  validationUnavailable,
  showMoveActions,
  canRecall,
  canSubmit,
  isSubmitting,
  onRecall,
  onSubmit,
  showExchangeActions,
  exchangeCount,
  isExchanging,
  onCancelExchange,
  onConfirmExchange,
}: MoveComposerProps) {
  const { t } = useLingui()
  const statusLabel = getStatusLabel(draftStatus, isMyTurn, t)
  const hasAdvisoryInvalidWords = draftStatus === 'ready_with_invalid_words'
  const showWordList = words.length > 0
  const isChecking = draftStatus === 'checking'

  return (
    <div className="space-y-2 p-3">
      {/* Status badge + score inline */}
      <div className="flex items-center gap-2 min-w-0">
        <Badge
          variant={getStatusBadgeVariant(draftStatus)}
          className={cn('shrink-0 gap-1 text-xs', getStatusBadgeClass(draftStatus))}
        >
          {isChecking && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {statusLabel}
        </Badge>
        {showWordList && totalScore > 0 && (
          <span
            className="ms-auto shrink-0 text-lg font-bold tabular-nums"
            aria-live="polite"
          >
            +{totalScore}
          </span>
        )}
      </div>

      {/* Validation error */}
      {draftStatus === 'invalid_local' && localErrorMessage && (
        <p className="flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {localErrorMessage}
        </p>
      )}

      {/* Validation offline */}
      {validationUnavailable && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <Trans>Validation offline — you can still submit.</Trans>
        </p>
      )}

      {/* Advisory unknown words */}
      {hasAdvisoryInvalidWords && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <XCircle className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden />
          <Trans>Contains unknown words. You can still submit.</Trans>
        </p>
      )}

      {/* Horizontal word pills */}
      {showWordList && (
        <div className="flex flex-wrap gap-1" aria-label={t`Words formed`}>
          {words.map(({ word, score }) => {
            const normalizedWord = word.toUpperCase()
            const validationState = wordValidationState[normalizedWord] ?? 'unknown'
            return (
              <span
                key={`${normalizedWord}-${score}`}
                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
              >
                <ValidationIndicator state={validationState} />
                <span className="font-semibold tracking-wide">{normalizedWord}</span>
                <span className="text-muted-foreground">+{score}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Exchange actions */}
      {showExchangeActions && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancelExchange} className="flex-1">
            <Trans>Cancel</Trans>
          </Button>
          <Button
            size="sm"
            onClick={onConfirmExchange}
            disabled={exchangeCount === 0 || isExchanging}
            className="flex-1"
          >
            {isExchanging ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowLeftRight className="size-3" />
            )}
            {exchangeCount > 0 ? (
              <Trans>Exchange ({exchangeCount})</Trans>
            ) : (
              <Trans>Exchange</Trans>
            )}
          </Button>
        </div>
      )}

      {/* Move actions */}
      {showMoveActions && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRecall} disabled={!canRecall}>
            <Trans>Recall</Trans>
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit} className="flex-1">
            {isSubmitting && <Loader2 className="size-3 animate-spin" />}
            <Trans>Submit</Trans>
          </Button>
        </div>
      )}
    </div>
  )
}

function ValidationIndicator({ state }: { state: DraftWordValidationState }) {
  if (state === 'checking') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
  }
  if (state === 'valid') {
    return <CheckCircle2 className="size-3 shrink-0 text-emerald-500" />
  }
  if (state === 'invalid') {
    return <XCircle className="size-3 shrink-0 text-destructive" />
  }
  return (
    <span
      className="inline-flex size-3 shrink-0 items-center justify-center rounded-full border border-border/80 text-[8px] leading-none text-muted-foreground"
      aria-hidden
    >
      ?
    </span>
  )
}

function getStatusBadgeVariant(
  status: MoveDraftStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'ready':
      return 'default'
    case 'checking':
      return 'secondary'
    case 'invalid_local':
    case 'ready_with_invalid_words':
      return 'destructive'
    default:
      return 'outline'
  }
}

function getStatusBadgeClass(status: MoveDraftStatus): string {
  if (status === 'ready') {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class names
    return 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-700 dark:border-emerald-700'
  }
  return ''
}

type LinguiT = ReturnType<typeof useLingui>['t']

function getStatusLabel(status: MoveDraftStatus, isMyTurn: boolean, t: LinguiT): string {
  if (!isMyTurn && status === 'empty') {
    return t`Waiting for your turn`
  }
  switch (status) {
    case 'empty':
      return t`Waiting for tiles`
    case 'invalid_local':
      return t`Invalid move`
    case 'ready':
      return t`Ready`
    case 'checking':
      return t`Checking`
    case 'ready_with_invalid_words':
      return t`Has unknown words`
    case 'validation_unavailable':
      return t`Validation offline`
    default:
      return t`Ready`
  }
}
