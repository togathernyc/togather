import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Platform } from "react-native";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: any;
  variant?: "rectangular" | "circular" | "text";
}

export function Skeleton({
  width = "100%",
  height = 20,
  borderRadius = 4,
  style,
  variant = "rectangular",
}: SkeletonProps) {
  const fadeAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0.3,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [fadeAnim]);

  const getBorderRadius = () => {
    if (variant === "circular") {
      return typeof width === "number" ? width / 2 : 999;
    }
    return borderRadius;
  };

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height: variant === "text" ? height : height,
          borderRadius: getBorderRadius(),
          opacity: fadeAnim,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: "#e0e0e0",
  },
});

// Skeleton components for common use cases
export function SkeletonText({
  lines = 3,
  style,
}: {
  lines?: number;
  style?: any;
}) {
  return (
    <View style={style}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={16}
          width={index === lines - 1 ? "80%" : "100%"}
          variant="text"
          style={{ marginBottom: 8 }}
        />
      ))}
    </View>
  );
}

export function SkeletonAvatar({
  size = 48,
  style,
}: {
  size?: number;
  style?: any;
}) {
  return (
    <Skeleton width={size} height={size} variant="circular" style={style} />
  );
}

export function SkeletonCard({ style }: { style?: any }) {
  return (
    <View style={[cardStyles.cardSkeleton, style]}>
      <View style={cardStyles.cardHeader}>
        <SkeletonAvatar size={40} />
        <View style={cardStyles.cardHeaderText}>
          <Skeleton width={120} height={16} />
          <Skeleton width={80} height={12} style={{ marginTop: 8 }} />
        </View>
      </View>
      <SkeletonText lines={2} style={{ marginTop: 16 }} />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  cardSkeleton: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 12,
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.1)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardHeaderText: {
    flex: 1,
    marginLeft: 12,
  },
});
