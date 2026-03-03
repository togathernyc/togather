import React from "react";
import { View, StyleSheet } from "react-native";

export function DragHandle() {
  return (
    <View style={styles.container}>
      <View style={styles.indicator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: "#fff",
  },
  indicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
  },
});
