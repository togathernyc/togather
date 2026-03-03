/**
 * Log Collector Utility
 *
 * Collects console logs in memory for debugging purposes.
 * Logs can be exported and sent to developers.
 */

interface LogEntry {
  timestamp: Date;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  data?: string;
}

class LogCollector {
  private logs: LogEntry[] = [];
  private maxLogs = 500; // Keep last 500 logs
  private isInitialized = false;

  /**
   * Initialize the log collector by intercepting console methods.
   * Call this once at app startup.
   */
  initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    const captureLog = (level: LogEntry['level'], args: unknown[]) => {
      try {
        const message = args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          })
          .join(' ');

        this.logs.push({
          timestamp: new Date(),
          level,
          message: message.substring(0, 1000), // Limit message length
        });

        // Keep only the last maxLogs entries
        if (this.logs.length > this.maxLogs) {
          this.logs = this.logs.slice(-this.maxLogs);
        }
      } catch {
        // Silently fail - don't break logging
      }
    };

    console.log = (...args) => {
      captureLog('log', args);
      originalConsole.log.apply(console, args);
    };

    console.warn = (...args) => {
      captureLog('warn', args);
      originalConsole.warn.apply(console, args);
    };

    console.error = (...args) => {
      captureLog('error', args);
      originalConsole.error.apply(console, args);
    };

    console.info = (...args) => {
      captureLog('info', args);
      originalConsole.info.apply(console, args);
    };

    console.debug = (...args) => {
      captureLog('debug', args);
      originalConsole.debug.apply(console, args);
    };
  }

  /**
   * Get all collected logs as a formatted string
   */
  getLogsAsString(): string {
    return this.logs
      .map((log) => {
        const time = log.timestamp.toISOString();
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
      })
      .join('\n');
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogEntry['level']): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Get logs containing a specific string
   */
  searchLogs(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.logs.filter((log) =>
      log.message.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear all collected logs
   */
  clear() {
    this.logs = [];
  }

  /**
   * Get the number of collected logs
   */
  getCount(): number {
    return this.logs.length;
  }

  /**
   * Get recent logs (last N entries)
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }
}

// Singleton instance
export const logCollector = new LogCollector();
