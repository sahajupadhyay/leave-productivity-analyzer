/**
 * Prisma Database Client Singleton
 * 
 * This module provides a production-ready, fault-tolerant Prisma Client instance
 * that prevents memory leaks and connection pool exhaustion during Next.js development
 * hot-reloading cycles.
 * 
 * CRITICAL FEATURES:
 * - Global singleton pattern to prevent multiple PrismaClient instances
 * - Automatic connection management with connection pooling
 * - Type-safe database queries with full TypeScript support
 * - Graceful error handling for database connectivity issues
 * 
 * SECURITY CONSIDERATIONS:
 * - Never expose this client directly to client-side code
 * - Always use within Server Components, API Routes, or Server Actions
 * - Validate and sanitize all inputs before database queries
 * 
 * PERFORMANCE:
 * - Connection pooling is managed automatically by Prisma
 * - Singleton prevents connection pool exhaustion in development
 * - Production environments should configure appropriate pool size via DATABASE_URL
 * 
 * @module lib/prisma
 * @author Principal Software Engineer
 * @version 1.0.0
 */

import { PrismaClient } from '@prisma/client';

/**
 * Custom error class for Prisma initialization failures
 * Provides specific error handling for database connectivity issues
 */
class PrismaInitializationError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PrismaInitializationError';
    
    // Maintains proper stack trace for V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PrismaInitializationError);
    }
  }
}

/**
 * Type definition for global Prisma instance
 * Extends NodeJS global namespace to include our Prisma client
 */
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Prisma Client Configuration Options
 * Configured for optimal performance and debugging
 */
const prismaClientOptions = {
  log: [
    // Production: Only log errors and warnings
    // Development: Include query logs for debugging
    ...(process.env.NODE_ENV === 'production'
      ? [
          { level: 'error' as const, emit: 'stdout' as const },
          { level: 'warn' as const, emit: 'stdout' as const },
        ]
      : [
          { level: 'query' as const, emit: 'stdout' as const },
          { level: 'error' as const, emit: 'stdout' as const },
          { level: 'warn' as const, emit: 'stdout' as const },
        ]),
  ],
};

/**
 * Validates that DATABASE_URL environment variable is properly configured
 * 
 * @throws {PrismaInitializationError} When DATABASE_URL is missing or invalid
 * @returns {boolean} True if DATABASE_URL is valid
 */
function validateDatabaseConfiguration(): boolean {
  if (!process.env.DATABASE_URL) {
    throw new PrismaInitializationError(
      'DATABASE_URL environment variable is not defined. ' +
      'Please ensure .env file exists with a valid MongoDB connection string.'
    );
  }

  // Basic MongoDB connection string validation
  const mongoDbPattern = /^mongodb(\+srv)?:\/\/.+/;
  if (!mongoDbPattern.test(process.env.DATABASE_URL)) {
    throw new PrismaInitializationError(
      'DATABASE_URL does not appear to be a valid MongoDB connection string. ' +
      'Expected format: mongodb://... or mongodb+srv://...'
    );
  }

  return true;
}

/**
 * Creates a new PrismaClient instance with proper error handling
 * 
 * @returns {PrismaClient} Configured Prisma Client instance
 * @throws {PrismaInitializationError} If client creation fails
 */
function createPrismaClient(): PrismaClient {
  try {
    validateDatabaseConfiguration();
    
    const client = new PrismaClient(prismaClientOptions);
    
    // Production: Set up connection error handlers
    if (process.env.NODE_ENV === 'production') {
      // Handle unexpected disconnections
      client.$on('error' as never, (error: Error) => {
        console.error('[Prisma] Database connection error:', error);
      });
    }
    
    return client;
  } catch (error) {
    if (error instanceof PrismaInitializationError) {
      throw error;
    }
    
    throw new PrismaInitializationError(
      'Failed to initialize Prisma Client. Check database configuration.',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Prisma Client Singleton Instance
 * 
 * DEVELOPMENT MODE:
 * - Uses global variable to persist across hot-reloads
 * - Prevents "Too many Prisma Client instances" error
 * - Single connection pool shared across module reloads
 * 
 * PRODUCTION MODE:
 * - Creates single instance per application lifecycle
 * - Optimized for serverless and edge environments
 * - Automatic connection pooling and management
 * 
 * USAGE:
 * ```typescript
 * import { prisma } from '@/lib/prisma';
 * 
 * export async function getEmployees() {
 *   try {
 *     return await prisma.employee.findMany({
 *       include: { attendance: true }
 *     });
 *   } catch (error) {
 *     // Handle database errors appropriately
 *     throw new Error('Failed to fetch employees');
 *   }
 * }
 * ```
 * 
 * @constant {PrismaClient} prisma - Global Prisma Client singleton instance
 */
export const prisma: PrismaClient = (() => {
  if (process.env.NODE_ENV === 'production') {
    // Production: Create new instance (serverless/edge optimized)
    return createPrismaClient();
  } else {
    // Development: Use global singleton to prevent hot-reload issues
    if (!global.prisma) {
      global.prisma = createPrismaClient();
    }
    return global.prisma;
  }
})();

/**
 * Gracefully disconnect Prisma Client
 * Should be called during application shutdown (e.g., process termination)
 * 
 * @async
 * @returns {Promise<void>}
 */
export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error('[Prisma] Error during disconnect:', error);
    // Rethrow to allow proper error handling by caller
    throw error;
  }
}

/**
 * Test database connectivity
 * Useful for health checks and initialization validation
 * 
 * @async
 * @returns {Promise<boolean>} True if connection successful
 * @throws {Error} If connection fails with detailed error message
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$connect();
    // Execute a simple query to verify full connectivity
    // MongoDB doesn't support raw SQL, so just use $connect
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Database connection test failed: ${errorMessage}. ` +
      'Verify DATABASE_URL and network connectivity.'
    );
  }
}

// Export type for use in application code
export type PrismaClientType = typeof prisma;
