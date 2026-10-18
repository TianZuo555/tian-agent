import { useEffect, useMemo, useState } from 'react';
import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { UsageDay } from '@/shared/types';
import { tian } from '../api';

const WEEKS = 26;
const LEVELS = [
  'bg-muted',
  'bg-primary/25',
  'bg-primary/50',
  'bg-primary/75',
  'bg-primary',
];

const dayKey = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const formatTokens = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}k`
      : `${value}`;

const formatCost = (value: number): string =>
  value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`;

const formatDate = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

interface Cell {
  key: string;
  date: Date;
  day: UsageDay | undefined;
  level: number;
}

/** GitHub-style calendar of model token usage over the last 26 weeks. */
export function UsageHeatmap({ scopeId = null }: { scopeId?: string | null }) {
  const [days, setDays] = useState<UsageDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    tian.usageStats(scopeId).then(
      (stats) => live && setDays(stats.days),
      (reason) => live && setError(String(reason)),
    );
    return () => {
      live = false;
    };
  }, [scopeId]);

  const { cells, monthLabels, totalTokens, totalCost } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const first = new Date(today);
    first.setDate(first.getDate() - first.getDay() - (WEEKS - 1) * 7);
    const firstKey = dayKey(first);

    const byDate = new Map<string, UsageDay>();
    let max = 0;
    let totalTokens = 0;
    let totalCost = 0;
    for (const day of days ?? []) {
      if (day.date < firstKey || day.date > dayKey(today)) continue;
      byDate.set(day.date, day);
      max = Math.max(max, day.totalTokens);
      totalTokens += day.totalTokens;
      totalCost += day.cost;
    }
    const level = (value: number) =>
      value <= 0 || max <= 0 ? 0 : Math.ceil((value / max) * 4);

    const cells: Cell[] = [];
    const monthLabels: (string | null)[] = [];
    for (let week = 0; week < WEEKS; week++) {
      let label: string | null = null;
      for (let weekday = 0; weekday < 7; weekday++) {
        const date = new Date(first);
        date.setDate(first.getDate() + week * 7 + weekday);
        if (date > today) break;
        if (date.getDate() === 1)
          label = date.toLocaleDateString('en-US', { month: 'short' });
        const key = dayKey(date);
        const day = byDate.get(key);
        cells.push({ key, date, day, level: level(day?.totalTokens ?? 0) });
      }
      monthLabels.push(label);
    }
    return { cells, monthLabels, totalTokens, totalCost };
  }, [days]);

  return (
    <TooltipProvider>
      <div
        aria-hidden="true"
        className="mb-0.5 grid gap-[3px] overflow-hidden"
        style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
      >
        {monthLabels.map((label, index) => (
          <span
            key={index}
            className="overflow-visible whitespace-nowrap text-[9px] text-muted-foreground leading-none"
          >
            {label}
          </span>
        ))}
      </div>
      <div
        role="list"
        aria-label={`Model usage in the last ${WEEKS} weeks`}
        className="grid grid-flow-col grid-rows-7 gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
      >
        {cells.map((cell) => (
          <Tooltip key={cell.key}>
            <TooltipTrigger
              render={
                <div
                  role="listitem"
                  aria-label={`${formatDate(cell.date)}: ${
                    cell.day
                      ? `${cell.day.totalTokens} tokens, ${formatCost(cell.day.cost)}`
                      : 'no usage'
                  }`}
                  className={cn(
                    'aspect-square rounded-[3px]',
                    LEVELS[cell.level],
                  )}
                />
              }
            />
            <TooltipPopup className="whitespace-nowrap">
              <div className="font-medium">{formatDate(cell.date)}</div>
              {cell.day ? (
                <div className="text-muted-foreground">
                  {formatTokens(cell.day.totalTokens)} tokens ·{' '}
                  {formatCost(cell.day.cost)} · {cell.day.messages}{' '}
                  {cell.day.messages === 1 ? 'message' : 'messages'}
                </div>
              ) : (
                <div className="text-muted-foreground">No usage</div>
              )}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span aria-live="polite" className="min-w-0 truncate">
          {error ??
            (days === null
              ? 'Loading usage…'
              : `${formatTokens(totalTokens)} tokens · ${formatCost(totalCost)} in the last ${WEEKS} weeks`)}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          Less
          {LEVELS.map((level) => (
            <span key={level} className={cn('size-2.5 rounded-[2px]', level)} />
          ))}
          More
        </span>
      </div>
    </TooltipProvider>
  );
}
