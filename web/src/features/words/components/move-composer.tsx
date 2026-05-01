import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@mochi/web'
import { Trans } from '@lingui/react/macro'
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
import { t } from '@lingui/core/macro'

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
  const statusLabel = getStatusLabel(draftStatus, isMyTurn)
  const hasAdvisoryInvalidWords = draftStatus === 'ready_with_invalid_words'
  const showWordList = words.length > 0
  const isChecking = draftStatus === 'checking'

  return (
    <Card className="mt-3 w-full py-4">
      <CardHeader className="px-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">
            <Trans>Move composer</Trans>
          </CardTitle>
          <Badge
            variant={getStatusBadgeVariant(draftStatus)}
            className={cn('shrink-0 gap-1', getStatusBadgeClass(draftStatus))}
          >
            {isChecking && (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            )}
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4">
        {/* Score preview */}
        <div
          className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5"
          aria-live="polite"
        >
          <span className="text-sm text-muted-foreground"><Trans>Preview score</Trans></span>
          <span
            className={cn(
              'text-xl font-bold tabular-nums transition-colors',
              showWordList && totalScore > 0
                ? 'text-foreground'
                : 'text-muted-foreground/50'
            )}
          >
            {showWordList ? totalScore : 0}
          </span>
        </div>

        {/* Validation error */}
        {draftStatus === 'invalid_local' && localErrorMessage && (
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="size-4" />
            <AlertTitle><Trans>Invalid move</Trans></AlertTitle>
            <AlertDescription>{localErrorMessage}</AlertDescription>
          </Alert>
        )}

        {/* Validation offline */}
        {validationUnavailable && (
          <Alert className="py-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            <AlertTitle><Trans>Dictionary unavailable</Trans></AlertTitle>
            <AlertDescription>
              <Trans>Validation is temporarily offline. You can still submit.</Trans>
            </AlertDescription>
          </Alert>
        )}

        {/* Advisory invalid words */}
        {hasAdvisoryInvalidWords && (
          <Alert className="py-2">
            <XCircle className="size-4 text-destructive" />
            <AlertTitle><Trans>Contains unknown words</Trans></AlertTitle>
            <AlertDescription>
              <Trans>Validation is advisory. You can still submit this move.</Trans>
            </AlertDescription>
          </Alert>
        )}

        {/* Word list */}
        {showWordList ? (
          <ul className="space-y-1.5 max-h-24 overflow-y-auto" aria-label={t`Words formed`}>
            {words.map(({ word, score }) => {
              const normalizedWord = word.toUpperCase()
              const validationState =
                wordValidationState[normalizedWord] ?? 'unknown'

              return (
                <li
                  key={`${normalizedWord}-${score}`}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-background px-3 py-1.5 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ValidationIndicator state={validationState} />
                    <span className="truncate font-semibold tracking-widest">
                      {normalizedWord}
                    </span>
                  </div>
                  <span className="ms-3 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
                    +{score}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isMyTurn
              ? "Place tiles on the board to preview score and words." : "Waiting for your turn to place tiles."}
          </p>
        )}

        {/* Exchange actions */}
        {showExchangeActions && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelExchange}
              className="flex-1"
            >
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
              Exchange{exchangeCount > 0 ? ` (${exchangeCount})` : ''}
            </Button>
          </div>
        )}

        {/* Move actions */}
        {showMoveActions && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onRecall}
              disabled={!canRecall}
            >
              <Trans>Recall</Trans>
            </Button>
            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="flex-1"
            >
              {isSubmitting && (
                <Loader2 className="size-3 animate-spin" />
              )}
              Submit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ValidationIndicator({ state }: { state: DraftWordValidationState }) {
  if (state === 'checking') {
    return (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    )
  }

  if (state === 'valid') {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
  }

  if (state === 'invalid') {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />
  }

  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border/80 text-[9px] leading-none text-muted-foreground"
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
    return 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-700 dark:border-emerald-700'
  }
  return ''
}

function getStatusLabel(status: MoveDraftStatus, isMyTurn: boolean): string {
  if (!isMyTurn && status === 'empty') {
    return 'Waiting for your turn'
  }

  switch (status) {
    case 'empty':
      return 'Waiting for tiles'
    case 'invalid_local':
      return 'Invalid move'
    case 'ready':
      return 'Ready'
    case 'checking':
      return 'Checking'
    case 'ready_with_invalid_words':
      return 'Has unknown words'
    case 'validation_unavailable':
      return 'Validation offline'
    default:
      return 'Ready'
  }
}
