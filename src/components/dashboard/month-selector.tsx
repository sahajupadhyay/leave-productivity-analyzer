/**
 * Month Selector Component
 * 
 * Client-side component for navigating between months in the dashboard.
 * Uses Next.js router for URL-based state management.
 * 
 * FEATURES:
 * - Previous/Next month navigation
 * - Current month indicator
 * - Accessible keyboard navigation
 * - URL-based state persistence
 * 
 * @module components/dashboard/month-selector
 * @author Principal Software Engineer
 * @version 1.0.0
 */

'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, addMonths, subMonths } from 'date-fns';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * MonthSelector component props
 */
export interface MonthSelectorProps {
  /** Current year being displayed */
  currentYear: number;
  
  /** Current month being displayed (1-12) */
  currentMonth: number;
  
  /** Optional CSS class name */
  className?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * MonthSelector Component
 * 
 * Provides intuitive month navigation controls with previous/next buttons
 * and current month display. Updates URL search params for state persistence.
 * 
 * USAGE:
 * ```tsx
 * <MonthSelector currentYear={2024} currentMonth={1} />
 * ```
 * 
 * ACCESSIBILITY:
 * - Keyboard navigable buttons
 * - ARIA labels for screen readers
 * - Clear visual focus indicators
 */
export function MonthSelector({
  currentYear,
  currentMonth,
  className,
}: MonthSelectorProps): React.JSX.Element {
  const router = useRouter();
  
  // Create current date from year/month (memoized to prevent recreation)
  const currentDate = useMemo(
    () => new Date(currentYear, currentMonth - 1, 1),
    [currentYear, currentMonth]
  );
  
  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================
  
  /**
   * Navigate to previous month
   * Updates URL search params and triggers server-side data fetch
   */
  const handlePreviousMonth = useCallback((): void => {
    const previousMonth = subMonths(currentDate, 1);
    const monthParam = format(previousMonth, 'yyyy-MM');
    router.push(`/?month=${monthParam}`);
  }, [currentDate, router]);
  
  /**
   * Navigate to next month
   * Updates URL search params and triggers server-side data fetch
   */
  const handleNextMonth = useCallback((): void => {
    const nextMonth = addMonths(currentDate, 1);
    const monthParam = format(nextMonth, 'yyyy-MM');
    router.push(`/?month=${monthParam}`);
  }, [currentDate, router]);
  
  /**
   * Navigate to current month (today)
   * Resets to current calendar month
   */
  const handleToday = useCallback((): void => {
    const today = new Date();
    const monthParam = format(today, 'yyyy-MM');
    router.push(`/?month=${monthParam}`);
  }, [router]);
  
  // ==========================================================================
  // COMPUTED VALUES
  // ==========================================================================
  
  // Format display text
  const displayText = format(currentDate, 'MMMM yyyy');
  
  // Check if current month is "today's" month
  const today = new Date();
  const isCurrentMonth = 
    today.getFullYear() === currentYear && 
    today.getMonth() + 1 === currentMonth;
  
  // ==========================================================================
  // RENDER
  // ==========================================================================
  
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {/* Previous Month Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={handlePreviousMonth}
          aria-label="Previous month"
          className="h-9 w-9"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        
        {/* Current Month Display */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium min-w-[140px] text-center">
            {displayText}
          </span>
          
          {/* Today Button (only show if not current month) */}
          {!isCurrentMonth && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToday}
              className="h-7 px-2 text-xs"
            >
              Today
            </Button>
          )}
        </div>
        
        {/* Next Month Button */}
        <Button
          variant="outline"
          size="icon"
          onClick={handleNextMonth}
          aria-label="Next month"
          className="h-9 w-9"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
