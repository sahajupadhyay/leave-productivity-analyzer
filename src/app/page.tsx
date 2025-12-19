/**
 * Leave & Productivity Analyzer - Main Dashboard Page
 * 
 * This is the primary entry point for the application, displaying a comprehensive
 * overview of employee attendance, leave tracking, and productivity metrics.
 * 
 * ARCHITECTURE:
 * - Server Component for optimal performance and SEO
 * - Server-side data fetching with Prisma
 * - URL-based state management via search params
 * - Client components for interactive elements only
 * 
 * FEATURES:
 * - Monthly attendance overview with aggregated metrics
 * - Per-employee productivity breakdown
 * - Visual indicators for performance issues
 * - Excel file upload for data import
 * - Month navigation controls
 * 
 * PERFORMANCE:
 * - Server-side rendering (SSR)
 * - Optimized database queries with aggregation
 * - Streaming-friendly architecture
 * 
 * @module app/page
 * @author Principal Software Engineer
 * @version 1.0.0
 */

import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getExpectedHours, calculateProductivity } from '@/lib/calculations';
import { getDaysInMonth, startOfMonth, endOfMonth, eachDayOfInterval, format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FileUpload } from '@/components/dashboard/file-upload';
import { MonthSelector } from '@/components/dashboard/month-selector';
import { AlertCircle, TrendingUp, Users, Calendar, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Page props with search parameters
 */
interface HomePageProps {
  searchParams: {
    /** Month in format YYYY-MM (e.g., "2024-01") */
    month?: string;
  };
}

/**
 * Employee productivity metrics
 */
interface EmployeeMetrics {
  /** Employee unique identifier */
  employeeId: string;
  
  /** Employee name */
  employeeName: string;
  
  /** Total hours worked in the period */
  workedHours: number;
  
  /** Total hours expected based on business rules */
  expectedHours: number;
  
  /** Number of absent days (leaves taken) */
  leavesTaken: number;
  
  /** Productivity percentage */
  productivityPercentage: number;
}

/**
 * Company-wide aggregated metrics
 */
interface CompanyMetrics {
  /** Total number of employees */
  totalEmployees: number;
  
  /** Average productivity across all employees */
  averageProductivity: number;
  
  /** Total leaves taken company-wide */
  totalLeavesTaken: number;
  
  /** Total hours worked company-wide */
  totalWorkedHours: number;
  
  /** Total expected hours company-wide */
  totalExpectedHours: number;
}

/**
 * Complete dashboard data structure
 */
interface DashboardData {
  /** Year being displayed */
  year: number;
  
  /** Month being displayed (1-12) */
  month: number;
  
  /** Company-wide aggregated metrics */
  companyMetrics: CompanyMetrics;
  
  /** Individual employee metrics */
  employeeMetrics: EmployeeMetrics[];
  
  /** Whether any data exists for this period */
  hasData: boolean;
}

// ============================================================================
// DATA FETCHING UTILITIES
// ============================================================================

/**
 * Calculate total expected hours for entire month
 * 
 * Applies business rules to every day in the month:
 * - Monday-Friday: 8.5 hours
 * - Saturday: 4.0 hours
 * - Sunday: 0 hours
 * 
 * This is the TRUE denominator for productivity calculations,
 * not just the sum of records (which would miss absent days).
 * 
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month (1-12)
 * @returns {number} Total expected hours for the month
 */
function calculateMonthlyExpectedHours(year: number, month: number): number {
  // Generate all dates in the month
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  
  const allDays = eachDayOfInterval({
    start: firstDay,
    end: lastDay,
  });
  
  // Sum expected hours for each day
  let totalExpected = 0;
  for (const day of allDays) {
    totalExpected += getExpectedHours(day);
  }
  
  return totalExpected;
}

/**
 * Fetch and aggregate dashboard data for specified month
 * 
 * ALGORITHM:
 * 1. Query all attendance records for the month
 * 2. Group records by employee
 * 3. Calculate per-employee metrics (worked hours, leaves, productivity)
 * 4. Aggregate company-wide metrics
 * 5. Return structured dashboard data
 * 
 * PERFORMANCE:
 * - Single database query with filtering
 * - In-memory aggregation (efficient for typical dataset sizes)
 * - Optimized for Next.js server-side rendering
 * 
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month (1-12)
 * @returns {Promise<DashboardData>} Aggregated dashboard data
 */
async function getData(year: number, month: number): Promise<DashboardData> {
  // Create date range for the month
  const startDate = startOfMonth(new Date(year, month - 1, 1));
  const endDate = endOfMonth(new Date(year, month - 1, 1));
  
  // Query all attendance records for this month (with employee data)
  const records = await prisma.attendanceRecord.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: {
      employee: true,
    },
    orderBy: [
      { employee: { name: 'asc' } },
      { date: 'asc' },
    ],
  });
  
  // Early return if no data
  if (records.length === 0) {
    return {
      year,
      month,
      companyMetrics: {
        totalEmployees: 0,
        averageProductivity: 0,
        totalLeavesTaken: 0,
        totalWorkedHours: 0,
        totalExpectedHours: 0,
      },
      employeeMetrics: [],
      hasData: false,
    };
  }
  
  // Calculate total expected hours for the month (applies to ALL employees)
  const monthlyExpectedHours = calculateMonthlyExpectedHours(year, month);
  
  // Group records by employee and calculate metrics
  const employeeMap = new Map<string, {
    id: string;
    name: string;
    workedHours: number;
    leavesTaken: number;
  }>();
  
  for (const record of records) {
    const existing = employeeMap.get(record.employeeId);
    
    if (existing) {
      // Accumulate data
      existing.workedHours += record.workedHours;
      if (record.status === 'ABSENT') {
        existing.leavesTaken += 1;
      }
    } else {
      // First record for this employee
      employeeMap.set(record.employeeId, {
        id: record.employeeId,
        name: record.employee.name,
        workedHours: record.workedHours,
        leavesTaken: record.status === 'ABSENT' ? 1 : 0,
      });
    }
  }
  
  // Convert to array and calculate productivity for each employee
  const employeeMetrics: EmployeeMetrics[] = Array.from(employeeMap.values()).map((emp) => {
    const productivity = calculateProductivity(emp.workedHours, monthlyExpectedHours);
    
    return {
      employeeId: emp.id,
      employeeName: emp.name,
      workedHours: Math.round(emp.workedHours * 100) / 100, // Round to 2 decimals
      expectedHours: monthlyExpectedHours,
      leavesTaken: emp.leavesTaken,
      productivityPercentage: productivity,
    };
  });
  
  // Calculate company-wide metrics
  const totalWorkedHours = employeeMetrics.reduce((sum, emp) => sum + emp.workedHours, 0);
  const totalLeavesTaken = employeeMetrics.reduce((sum, emp) => sum + emp.leavesTaken, 0);
  const totalExpectedHours = monthlyExpectedHours * employeeMetrics.length;
  const averageProductivity = employeeMetrics.length > 0
    ? employeeMetrics.reduce((sum, emp) => sum + emp.productivityPercentage, 0) / employeeMetrics.length
    : 0;
  
  return {
    year,
    month,
    companyMetrics: {
      totalEmployees: employeeMetrics.length,
      averageProductivity: Math.round(averageProductivity * 10) / 10,
      totalLeavesTaken,
      totalWorkedHours: Math.round(totalWorkedHours * 100) / 100,
      totalExpectedHours: Math.round(totalExpectedHours * 100) / 100,
    },
    employeeMetrics,
    hasData: true,
  };
}

/**
 * Parse and validate month parameter from search params
 * 
 * Expected format: "YYYY-MM" (e.g., "2024-01")
 * Falls back to current month if invalid or missing.
 * 
 * @param {string | undefined} monthParam - Month parameter from URL
 * @returns {{ year: number; month: number }} Parsed year and month
 */
function parseMonthParam(monthParam: string | undefined): { year: number; month: number } {
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;
  
  if (!monthParam) {
    return { year: defaultYear, month: defaultMonth };
  }
  
  // Validate format: YYYY-MM
  const match = monthParam.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return { year: defaultYear, month: defaultMonth };
  }
  
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  
  // Validate ranges
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return { year: defaultYear, month: defaultMonth };
  }
  
  return { year, month };
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

/**
 * Summary metric card component
 * 
 * Displays a single metric with icon, title, value, and optional description
 */
function MetricCard({
  icon: Icon,
  title,
  value,
  description,
  variant = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string | number;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}): React.JSX.Element {
  const variantStyles = {
    default: 'text-foreground',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-yellow-600 dark:text-yellow-400',
    danger: 'text-red-600 dark:text-red-400',
  };
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', variantStyles[variant])}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Empty state component when no data exists
 */
function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <FileSpreadsheet className="h-16 w-16 text-muted-foreground/50" />
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">No Data Found</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          No attendance records exist for this month. Please upload an Excel file
          containing employee attendance data to get started.
        </p>
      </div>
    </div>
  );
}

/**
 * Employee metrics table component
 */
function EmployeeTable({ employees }: { employees: EmployeeMetrics[] }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Performance Overview</CardTitle>
        <CardDescription>
          Detailed breakdown of attendance, leave usage, and productivity by employee
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee Name</TableHead>
                <TableHead className="text-right">Worked Hours</TableHead>
                <TableHead className="text-right">Expected Hours</TableHead>
                <TableHead className="text-right">Leaves Taken</TableHead>
                <TableHead className="text-right">Productivity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => {
                const isLowProductivity = employee.productivityPercentage < 50;
                const isHighLeaves = employee.leavesTaken > 2;
                
                return (
                  <TableRow key={employee.employeeId}>
                    <TableCell className="font-medium">
                      {employee.employeeName}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {employee.workedHours.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {employee.expectedHours.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={isHighLeaves ? 'destructive' : 'secondary'}
                        className={cn(
                          isHighLeaves && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        )}
                      >
                        {employee.leavesTaken}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          'font-semibold',
                          isLowProductivity
                            ? 'text-red-600 dark:text-red-400'
                            : employee.productivityPercentage >= 90
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-foreground'
                        )}
                      >
                        {employee.productivityPercentage.toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

/**
 * Home Page - Main Dashboard
 * 
 * Server Component that fetches and displays attendance data.
 * Supports month navigation via URL search params.
 * 
 * @param {HomePageProps} props - Page props with search params
 * @returns {Promise<React.JSX.Element>} Rendered dashboard page
 */
export default async function Home({ searchParams }: HomePageProps): Promise<React.JSX.Element> {
  // Await search params (Next.js 15+ async change)
  const resolvedSearchParams = await searchParams;
  
  // Parse month from search params
  const { year, month } = parseMonthParam(resolvedSearchParams.month);
  
  // Fetch dashboard data
  const data = await getData(year, month);
  
  // Format month for display
  const monthName = format(new Date(year, month - 1, 1), 'MMMM yyyy');
  
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                Leave & Productivity Analyzer
              </h1>
              <p className="text-muted-foreground mt-1">
                Monitor attendance, track leaves, and analyze team productivity
              </p>
            </div>
            
            {/* Month Selector */}
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <MonthSelector currentYear={year} currentMonth={month} />
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Upload Section */}
        <section>
          <FileUpload />
        </section>
        
        {data.hasData ? (
          <>
            {/* Summary Metrics */}
            <section>
              <h2 className="text-2xl font-bold mb-4">Overview - {monthName}</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  icon={Users}
                  title="Total Employees"
                  value={data.companyMetrics.totalEmployees}
                  description="Active employees this month"
                />
                
                <MetricCard
                  icon={TrendingUp}
                  title="Average Productivity"
                  value={`${data.companyMetrics.averageProductivity.toFixed(1)}%`}
                  description="Company-wide average"
                  variant={
                    data.companyMetrics.averageProductivity >= 90
                      ? 'success'
                      : data.companyMetrics.averageProductivity < 50
                      ? 'danger'
                      : 'default'
                  }
                />
                
                <MetricCard
                  icon={AlertCircle}
                  title="Total Leaves Taken"
                  value={data.companyMetrics.totalLeavesTaken}
                  description={`${(data.companyMetrics.totalLeavesTaken / data.companyMetrics.totalEmployees).toFixed(1)} leaves per employee`}
                  variant={
                    data.companyMetrics.totalLeavesTaken / data.companyMetrics.totalEmployees > 5
                      ? 'warning'
                      : 'default'
                  }
                />
                
                <MetricCard
                  icon={Calendar}
                  title="Hours Worked"
                  value={data.companyMetrics.totalWorkedHours.toFixed(0)}
                  description={`of ${data.companyMetrics.totalExpectedHours.toFixed(0)} expected`}
                />
              </div>
            </section>
            
            {/* Performance Alert */}
            {data.companyMetrics.averageProductivity < 70 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Low Productivity Alert</AlertTitle>
                <AlertDescription>
                  Company-wide productivity is below 70%. Review individual employee
                  performance and consider addressing attendance issues.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Employee Table */}
            <section>
              <EmployeeTable employees={data.employeeMetrics} />
            </section>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </main>
  );
}

/**
 * Generate static params for pre-rendering
 * 
 * This enables static generation of common months for better performance.
 * Uncomment if you want to pre-generate specific months.
 */
// export async function generateStaticParams() {
//   const now = new Date();
//   return [
//     { month: format(now, 'yyyy-MM') },
//   ];
// }

/**
 * Revalidate page data
 * Set to 0 for always fresh data, or a number for ISR (Incremental Static Regeneration)
 */
export const revalidate = 0; // Always fetch fresh data
