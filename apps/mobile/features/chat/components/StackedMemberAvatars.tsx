import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { Avatar } from "@components/ui/Avatar";

type StackMember = {
  name: string;
  imageUrl: string | null;
  /** When true, the slashed-bell badge overlays this avatar in the stack. */
  notificationsDisabled?: boolean;
};

type Props = {
  members: StackMember[];
  totalCount?: number;
  surfaceColor: string;
  /** Overall bounding-box edge in pt. Default 56 (inbox row). */
  size?: number;
};

export function StackedMemberAvatars({
  members,
  totalCount,
  surfaceColor,
  size = 56,
}: Props) {
  const visible = members.slice(0, 4);
  const total = totalCount ?? members.length;

  if (visible.length === 0) {
    return <View style={{ width: size, height: size }} />;
  }

  if (visible.length === 1) {
    const m = visible[0]!;
    return (
      <View style={{ width: size, height: size }}>
        <Avatar
          name={m.name}
          imageUrl={m.imageUrl ?? undefined}
          size={size}
          notificationsDisabled={m.notificationsDisabled}
          notificationsBadgeRingColor={surfaceColor}
        />
      </View>
    );
  }

  // Sizes are proportional to the bounding box so the cluster scales for
  // header (36), inbox (56), and info-hero (96) callers without re-tuning.
  const back2 = Math.round(size * 0.71);
  const front2 = Math.round(size * 0.64);
  const front2Wrap = front2 + 4;
  const a3 = Math.round(size * 0.57);
  const a3Wrap = a3 + 4;
  const a4 = Math.round(size * 0.54);
  const a4Wrap = a4 + 4;
  const overflowFont = Math.max(10, Math.round(size * 0.22));

  if (visible.length === 2) {
    return (
      <View style={[styles.box, { width: size, height: size }]}>
        <Avatar
          name={visible[0]!.name}
          imageUrl={visible[0]!.imageUrl ?? undefined}
          size={back2}
          style={styles.topLeft}
        />
        <View
          style={[
            styles.bottomRight,
            {
              width: front2Wrap,
              height: front2Wrap,
              borderRadius: front2Wrap / 2,
              backgroundColor: surfaceColor,
              padding: 2,
            },
          ]}
        >
          <Avatar
            name={visible[1]!.name}
            imageUrl={visible[1]!.imageUrl ?? undefined}
            size={front2}
          />
        </View>
      </View>
    );
  }

  if (visible.length === 3) {
    const ring = (positionStyle: any, m: StackMember) => (
      <View
        style={[
          styles.absolute,
          positionStyle,
          {
            width: a3Wrap,
            height: a3Wrap,
            borderRadius: a3Wrap / 2,
            backgroundColor: surfaceColor,
            padding: 2,
          },
        ]}
      >
        <Avatar name={m.name} imageUrl={m.imageUrl ?? undefined} size={a3} />
      </View>
    );
    const bottomCenterStyle = {
      bottom: 0,
      left: Math.round((size - a3Wrap) / 2),
    };
    return (
      <View style={[styles.box, { width: size, height: size }]}>
        {ring(styles.topLeft, visible[0]!)}
        {ring(styles.topRight, visible[1]!)}
        {ring(bottomCenterStyle, visible[2]!)}
      </View>
    );
  }

  // 4+ members: quad cluster. If there are more members than fit, render the
  // first three avatars and use the 4th slot for a "+N" badge.
  const overflow = total - 3;
  const showOverflow = total > 4;
  const ring4 = (positionStyle: any, m: StackMember) => (
    <View
      style={[
        styles.absolute,
        positionStyle,
        {
          width: a4Wrap,
          height: a4Wrap,
          borderRadius: a4Wrap / 2,
          backgroundColor: surfaceColor,
          padding: 2,
        },
      ]}
    >
      <Avatar name={m.name} imageUrl={m.imageUrl ?? undefined} size={a4} />
    </View>
  );
  return (
    <View style={[styles.box, { width: size, height: size }]}>
      {ring4(styles.topLeft, visible[0]!)}
      {ring4(styles.topRight, visible[1]!)}
      {ring4(styles.bottomLeft, visible[2]!)}
      {showOverflow ? (
        <View
          style={[
            styles.absolute,
            styles.bottomRight,
            {
              width: a4Wrap,
              height: a4Wrap,
              borderRadius: a4Wrap / 2,
              backgroundColor: surfaceColor,
              padding: 2,
            },
          ]}
        >
          <View
            style={[
              styles.overflowInner,
              { width: a4, height: a4, borderRadius: a4 / 2 },
            ]}
          >
            <Text
              style={[styles.overflowText, { fontSize: overflowFont }]}
              numberOfLines={1}
            >
              +{overflow}
            </Text>
          </View>
        </View>
      ) : (
        ring4(styles.bottomRight, visible[3]!)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: "relative" },
  absolute: { position: "absolute" },
  topLeft: { position: "absolute", top: 0, left: 0 },
  topRight: { position: "absolute", top: 0, right: 0 },
  bottomLeft: { position: "absolute", bottom: 0, left: 0 },
  bottomRight: { position: "absolute", bottom: 0, right: 0 },
  overflowInner: {
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  overflowText: {
    color: "#fff",
    fontWeight: "700",
  },
});
