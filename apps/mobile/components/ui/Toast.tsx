import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Platform,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastProps {
  visible: boolean;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
  position?: 'top' | 'bottom' | 'center';
}

export function Toast({
  visible,
  message,
  type = 'info',
  duration = 3000,
  onClose,
  position = 'top',
}: ToastProps) {
  const { colors } = useTheme();
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(position === 'top' ? -100 : position === 'bottom' ? 100 : 0)).current;

  const handleClose = React.useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: position === 'top' ? -100 : position === 'bottom' ? 100 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }, [fadeAnim, slideAnim, position, onClose]);

  useEffect(() => {
    if (visible) {
      // Fade in and slide
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto close after duration
      const timer = setTimeout(() => {
        handleClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, fadeAnim, slideAnim, duration, handleClose]);

  if (!visible) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'close-circle';
      case 'warning':
        return 'warning';
      case 'info':
        return 'information-circle';
      default:
        return 'information-circle';
    }
  };

  // Toast background colors are intentionally branded/semantic status colors
  const getColor = () => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'error':
        return colors.error;
      case 'warning':
        return colors.warning;
      case 'info':
        return '#17a2b8';
      default:
        return '#17a2b8';
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.container,
            styles[position],
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={[styles.toast, { backgroundColor: getColor() }]}>
            <Ionicons name={getIcon() as any} size={24} color="#fff" style={styles.icon} />
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    maxWidth: 400,
    zIndex: 9999,
  },
  top: {
    marginTop: Platform.OS === 'web' ? 20 : 60,
  },
  bottom: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 20 : 100,
  },
  center: {
    position: 'absolute',
    top: '50%',
    marginTop: -50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5,
      },
    }),
  },
  icon: {
    marginRight: 12,
  },
  message: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  closeButton: {
    marginLeft: 12,
    padding: 4,
  },
});

// Toast Manager for global usage
let toastRef: {
  show: (message: string, type?: ToastType, duration?: number) => void;
} | null = null;

export const ToastManager = {
  setRef: (ref: typeof toastRef) => {
    toastRef = ref;
  },
  show: (message: string, type?: ToastType, duration?: number) => {
    if (toastRef) {
      toastRef.show(message, type, duration);
    } else {
      console.warn('Toast ref not set. Use ToastContainer to set the ref.');
    }
  },
  success: (message: string, duration?: number) => {
    ToastManager.show(message, 'success', duration);
  },
  error: (message: string, duration?: number) => {
    ToastManager.show(message, 'error', duration);
  },
  warning: (message: string, duration?: number) => {
    ToastManager.show(message, 'warning', duration);
  },
  info: (message: string, duration?: number) => {
    ToastManager.show(message, 'info', duration);
  },
};

// Toast Container Component for global usage
interface ToastContainerProps {
  children: React.ReactNode;
}

export function ToastContainer({ children }: ToastContainerProps) {
  const [toast, setToast] = React.useState<{
    visible: boolean;
    message: string;
    type: ToastType;
    duration: number;
  }>({
    visible: false,
    message: '',
    type: 'info',
    duration: 3000,
  });

  useEffect(() => {
    ToastManager.setRef({
      show: (message: string, type: ToastType = 'info', duration: number = 3000) => {
        setToast({ visible: true, message, type, duration });
      },
    });
  }, []);

  return (
    <>
      {children}
      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        duration={toast.duration}
        onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </>
  );
}
