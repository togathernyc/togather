import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { SentryUtils } from '@providers/SentryProvider';
import { convexVanilla, api } from '@services/api/convex';

const sadGif = require('../assets/sad.gif');

interface Props {
  children: React.ReactNode;
  FallbackComponent?: React.ComponentType<{ error: Error; resetError: () => void }>;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** React component stack — our best "which screen" breadcrumb. */
  componentStack: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({ componentStack: errorInfo.componentStack ?? null });

    // Report error to Sentry with component stack trace
    SentryUtils.captureException(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    });
  }

  resetError = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  goHome = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    // Navigate to root and reset the navigation stack
    // Use dismissAll to close any modals, then replace to reset to root
    try {
      router.dismissAll();
    } catch {
      // dismissAll may fail if no modals are open, that's fine
    }
    router.replace('/');
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.FallbackComponent) {
        return <this.props.FallbackComponent error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <DefaultErrorFallback
          error={this.state.error}
          componentStack={this.state.componentStack}
          onTryAgain={this.resetError}
          onGoHome={this.goHome}
        />
      );
    }

    return this.props.children;
  }
}

interface FallbackProps {
  error: Error;
  componentStack: string | null;
  onTryAgain: () => void;
  onGoHome: () => void;
}

/**
 * Friendly, restart-focused fallback shown for any uncaught render error.
 *
 * Deliberately never surfaces the raw error string to the user (it's internal
 * and often unintelligible — e.g. a redacted Convex "Server Error"). Instead it
 * offers a "Send to developer" action that emails the full technical details to
 * the Togather team.
 */
function DefaultErrorFallback({
  error,
  componentStack,
  onTryAgain,
  onGoHome,
}: FallbackProps) {
  const [sendState, setSendState] = React.useState<
    'idle' | 'sending' | 'sent' | 'failed'
  >('idle');

  const buildReport = React.useCallback(() => {
    const appVersion = Constants.expoConfig?.version ?? 'unknown';
    const nativeVersion = Application.nativeApplicationVersion ?? 'unknown';
    const nativeBuild = Application.nativeBuildVersion ?? 'unknown';
    // Trim the component stack to the top frames — enough to identify the
    // screen without pasting the entire tree.
    const screenTrace = (componentStack ?? 'unavailable')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .join('\n');

    const subject = `Togather error report — ${error.name || 'Error'}`;
    const body = [
      'Please describe what you were doing when this happened:',
      '',
      '',
      '— — — — — — — — — — — — — — — — — — — —',
      'Technical details (for the Togather team)',
      '— — — — — — — — — — — — — — — — — — — —',
      `Time: ${new Date().toISOString()}`,
      `App version: ${appVersion} (native ${nativeVersion} / build ${nativeBuild})`,
      `Platform: ${Platform.OS} ${String(Platform.Version)}`,
      '',
      'Screen (component trace):',
      screenTrace,
      '',
      'Error:',
      `${error.name}: ${error.message}`,
      '',
      'Stack:',
      error.stack ?? 'unavailable',
    ].join('\n');

    return { subject, body };
  }, [error, componentStack]);

  const handleSendToDeveloper = React.useCallback(async () => {
    setSendState('sending');
    const { subject, body } = buildReport();
    try {
      const result = await convexVanilla.action(
        api.functions.support.sendErrorReport.sendErrorReport,
        { subject, body },
      );
      setSendState(result.success ? 'sent' : 'failed');
    } catch {
      // Never let the report flow crash the fallback itself.
      setSendState('failed');
    }
  }, [buildReport]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Image source={sadGif} style={styles.graphic} resizeMode="contain" />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The app hit an unexpected snag. Tap Try Again — and if it keeps
          happening, fully close the app (swipe it away) and reopen it.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onTryAgain}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleSendToDeveloper}
          activeOpacity={0.8}
          disabled={sendState === 'sending' || sendState === 'sent'}
        >
          <Text style={styles.secondaryButtonText}>
            {sendState === 'sending'
              ? 'Sending…'
              : sendState === 'sent'
                ? 'Thanks — report sent'
                : sendState === 'failed'
                  ? 'Failed to send — tap to retry'
                  : 'Send to developer'}
          </Text>
        </TouchableOpacity>
        {sendState === 'failed' && (
          <Text style={styles.errorText}>
            We couldn't reach our server. Check your connection and try
            again.
          </Text>
        )}

        <TouchableOpacity onPress={onGoHome} activeOpacity={0.6}>
          <Text style={styles.goHomeText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  content: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  graphic: {
    width: 120,
    height: 120,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d0d0d0',
    marginBottom: 16,
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 16,
  },
  goHomeText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '500',
  },
});
