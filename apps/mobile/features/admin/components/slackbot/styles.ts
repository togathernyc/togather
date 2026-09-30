import { Platform, StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  // Page
  container: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  emptyText: { fontSize: 16, marginTop: 12, textAlign: "center" },
  emptySubtext: { fontSize: 14, marginTop: 4, textAlign: "center" },

  // Sections
  section: { marginTop: 24, paddingHorizontal: 16 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    marginHorizontal: 4,
    gap: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  sectionSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },

  // Cards and rows
  card: {
    borderRadius: 12,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  cardGap: { gap: 12 },
  emptyCardText: { fontSize: 14, textAlign: "center", paddingVertical: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    gap: 12,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rowLabel: { fontSize: 16 },
  rowValue: { fontSize: 15 },
  rowDetail: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },

  // Overview
  overviewHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  overviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewTitle: { fontSize: 18, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 4,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 13, fontWeight: "600" },
  overviewSummary: { fontSize: 15, lineHeight: 21, marginTop: 14 },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 14,
  },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Campuses
  campusHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  campusName: { fontSize: 17, fontWeight: "600" },
  campusBody: { marginTop: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 },

  // Buttons
  smallButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    gap: 4,
  },
  smallButtonText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  primaryButtonText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  iconButton: { padding: 4 },

  // Chips
  chipContainer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  chipText: { fontSize: 13 },
  selectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1 },
  selectChipSmall: { paddingHorizontal: 10, paddingVertical: 6 },
  selectChipText: { fontSize: 14, fontWeight: "500" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 12, fontWeight: "600", color: "#fff" },

  // Advanced
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  configRow: { paddingVertical: 4 },
  configLabel: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  configValue: { fontSize: 15 },
  configValueSmall: { fontSize: 14, lineHeight: 20 },

  footer: { padding: 20, alignItems: "center" },
  footerText: { fontSize: 12 },

  // Modals
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: "600", flexShrink: 1, textAlign: "center" },
  modalAction: { fontSize: 16, minWidth: 60 },
  modalBody: { padding: 16 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerName: { fontSize: 16 },
  pickerSubtext: { fontSize: 13, marginTop: 1 },
  addedBadge: { fontSize: 13, fontStyle: "italic" },
  emptyListText: { fontSize: 15, textAlign: "center", marginTop: 40 },
  editorLabel: { fontSize: 14, fontWeight: "600", marginBottom: 10, textTransform: "uppercase" },
  editorHint: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 10 },
  textFieldSingle: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 4,
  },
  textFieldMulti: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 80,
    marginTop: 4,
    lineHeight: 22,
  },
  subCard: { borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth },
});
