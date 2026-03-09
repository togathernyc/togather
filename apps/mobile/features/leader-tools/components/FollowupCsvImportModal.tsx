import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import Papa from "papaparse";
import { api, Id, useAuthenticatedMutation, useAuthenticatedQuery } from "@services/api/convex";
import type {
  CsvImportCustomFieldDef,
  CsvImportField,
  CsvImportMapping,
  CsvImportSourceRow,
} from "./followupCsvImportHelpers";
import {
  buildCsvImportRowsPayload,
  getDefaultCustomFieldMapping,
  getDefaultCsvImportMapping,
} from "./followupCsvImportHelpers";

type CsvImportPreviewResult = {
  summary: {
    totalRows: number;
    readyRows: number;
    skippedRows: number;
    duplicateRows: number;
    invalidPhoneRows: number;
    missingFirstNameRows: number;
    usersToCreate: number;
    usersToUpdate: number;
    communityAdds: number;
    communityReactivations: number;
    groupAdds: number;
    groupReactivations: number;
    followupCreates: number;
    notesCreates: number;
    notesAppends: number;
    customFieldUpdates: number;
  };
  rows: Array<{
    rowNumber: number;
    phone?: string;
    status: "ready" | "skipped";
    reasons: string[];
    actions: {
      user: string;
      profileUpdates: string[];
      community: string;
      group: string;
      followup: string;
      notes: string;
      customFields?: string;
    };
  }>;
};

type Props = {
  visible: boolean;
  groupId: string;
  onClose: () => void;
  onImported?: () => void;
};

const REQUIRED_FIELDS: CsvImportField[] = ["firstName", "phone"];
const FIELD_ORDER: Array<{ key: CsvImportField; label: string; required?: boolean }> = [
  { key: "firstName", label: "First Name", required: true },
  { key: "phone", label: "Phone", required: true },
  { key: "lastName", label: "Last Name" },
  { key: "email", label: "Email" },
  { key: "zipCode", label: "ZIP Code" },
  { key: "dateOfBirth", label: "Date of Birth" },
  { key: "notes", label: "Notes" },
];

function isRequiredField(field: CsvImportField) {
  return REQUIRED_FIELDS.includes(field);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error";
}

export function FollowupCsvImportModal({ visible, groupId, onClose, onImported }: Props) {
  const previewImport = useAuthenticatedMutation(api.functions.memberFollowups.previewCsvImport);
  const applyImport = useAuthenticatedMutation(api.functions.memberFollowups.applyCsvImport);
  const followupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  ) as { followupColumnConfig?: { customFields?: CsvImportCustomFieldDef[] } } | null | undefined;
  const customFields = useMemo<CsvImportCustomFieldDef[]>(
    () => (followupConfig?.followupColumnConfig?.customFields ?? []) as CsvImportCustomFieldDef[],
    [followupConfig?.followupColumnConfig?.customFields]
  );

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<CsvImportSourceRow[]>([]);
  const [mapping, setMapping] = useState<CsvImportMapping>({
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    zipCode: null,
    dateOfBirth: null,
    notes: null,
  });
  const [customFieldMapping, setCustomFieldMapping] = useState<Record<string, string | null>>({});
  const [selectedFields, setSelectedFields] = useState<Set<CsvImportField>>(
    new Set(REQUIRED_FIELDS)
  );
  const [selectedCustomSlots, setSelectedCustomSlots] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [previewResult, setPreviewResult] = useState<CsvImportPreviewResult | null>(null);

  useEffect(() => {
    if (!visible) {
      setFileName(null);
      setHeaders([]);
      setSourceRows([]);
      setParseError(null);
      setPreviewResult(null);
      setSelectedFields(new Set(REQUIRED_FIELDS));
      setSelectedCustomSlots(new Set());
      setMapping({
        firstName: null,
        lastName: null,
        phone: null,
        email: null,
        zipCode: null,
        dateOfBirth: null,
        notes: null,
      });
      setCustomFieldMapping({});
    }
  }, [visible]);

  const payloadRows = useMemo(
    () =>
      buildCsvImportRowsPayload(
        sourceRows,
        mapping,
        selectedFields,
        customFieldMapping,
        selectedCustomSlots
      ),
    [sourceRows, mapping, selectedFields, customFieldMapping, selectedCustomSlots]
  );

  const canPreview = useMemo(() => {
    if (payloadRows.length === 0) return false;
    return REQUIRED_FIELDS.every(
      (field) => selectedFields.has(field) && mapping[field]
    );
  }, [mapping, payloadRows.length, selectedFields]);

  const parseCsvText = (name: string, csvText: string) => {
    setIsParsing(true);
    setParseError(null);
    setPreviewResult(null);

    Papa.parse<CsvImportSourceRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (result: Papa.ParseResult<CsvImportSourceRow>) => {
        const detectedHeaders = (result.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
        if (detectedHeaders.length === 0) {
          setParseError("No CSV headers were detected.");
          setHeaders([]);
          setSourceRows([]);
          setIsParsing(false);
          return;
        }

        const rows = (result.data ?? []).filter((row) =>
          Object.values(row).some((value) => String(value ?? "").trim().length > 0)
        );

        if (rows.length === 0) {
          setParseError("CSV has headers but no data rows.");
          setHeaders(detectedHeaders);
          setSourceRows([]);
          setIsParsing(false);
          return;
        }

        const defaultMapping = getDefaultCsvImportMapping(detectedHeaders);
        const defaultCustomMapping = getDefaultCustomFieldMapping(detectedHeaders, customFields);
        const nextSelected = new Set<CsvImportField>(REQUIRED_FIELDS);
        for (const field of FIELD_ORDER) {
          if (!isRequiredField(field.key) && defaultMapping[field.key]) {
            nextSelected.add(field.key);
          }
        }
        const nextSelectedCustomSlots = new Set<string>();
        for (const field of customFields) {
          if (defaultCustomMapping[field.slot]) {
            nextSelectedCustomSlots.add(field.slot);
          }
        }

        setFileName(name);
        setHeaders(detectedHeaders);
        setSourceRows(rows);
        setMapping(defaultMapping);
        setCustomFieldMapping(defaultCustomMapping);
        setSelectedFields(nextSelected);
        setSelectedCustomSlots(nextSelectedCustomSlots);
        setIsParsing(false);
      },
      error: (error: Error) => {
        setParseError(error.message || "Could not parse CSV.");
        setIsParsing(false);
      },
    });
  };

  const handleSelectCsv = () => {
    if (Platform.OS !== "web") {
      setParseError("CSV import is currently available on web.");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      parseCsvText(file.name, text);
    };
    input.click();
  };

  const handleToggleField = (field: CsvImportField) => {
    if (isRequiredField(field)) return;
    setPreviewResult(null);
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleMappingChange = (field: CsvImportField, header: string | null) => {
    setPreviewResult(null);
    setMapping((prev) => ({ ...prev, [field]: header }));
    if (!isRequiredField(field)) {
      setSelectedFields((prev) => {
        const next = new Set(prev);
        if (header) next.add(field);
        else next.delete(field);
        return next;
      });
    }
  };

  const handleToggleCustomField = (slot: string) => {
    setPreviewResult(null);
    setSelectedCustomSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  };

  const handleCustomMappingChange = (slot: string, header: string | null) => {
    setPreviewResult(null);
    setCustomFieldMapping((prev) => ({ ...prev, [slot]: header }));
    setSelectedCustomSlots((prev) => {
      const next = new Set(prev);
      if (header) next.add(slot);
      else next.delete(slot);
      return next;
    });
  };

  const handleRunPreview = async () => {
    if (!canPreview) return;
    setIsPreviewing(true);
    try {
      const result = (await previewImport({
        groupId: groupId as Id<"groups">,
        rows: payloadRows,
      })) as CsvImportPreviewResult;
      setPreviewResult(result);
    } catch (error: unknown) {
      Alert.alert("Preview failed", getErrorMessage(error) ?? "Could not preview CSV import.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleApplyImport = async () => {
    if (!previewResult || previewResult.summary.readyRows === 0) return;
    setIsApplying(true);
    try {
      const result = (await applyImport({
        groupId: groupId as Id<"groups">,
        rows: payloadRows,
      })) as CsvImportPreviewResult;
      setPreviewResult(result);
      Alert.alert("Import complete", `${result.summary.readyRows} rows imported.`);
      onImported?.();
    } catch (error: unknown) {
      Alert.alert("Import failed", getErrorMessage(error) ?? "Could not import CSV.");
    } finally {
      setIsApplying(false);
    }
  };

  const skippedRows = previewResult?.rows.filter((row) => row.status === "skipped").slice(0, 20) ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Import People from CSV</Text>
            <TouchableOpacity onPress={onClose} style={styles.iconButton}>
              <Ionicons name="close" size={18} color="#4B5563" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>1) Upload CSV</Text>
              <TouchableOpacity style={styles.primaryOutlineButton} onPress={handleSelectCsv}>
                <Ionicons name="cloud-upload-outline" size={14} color="#2563EB" />
                <Text style={styles.primaryOutlineButtonText}>
                  {fileName ? "Replace file" : "Choose CSV file"}
                </Text>
              </TouchableOpacity>
              {isParsing ? <ActivityIndicator size="small" color="#2563EB" /> : null}
              {fileName ? <Text style={styles.mutedText}>{fileName}</Text> : null}
              {sourceRows.length > 0 ? (
                <Text style={styles.mutedText}>
                  {sourceRows.length} data rows detected
                </Text>
              ) : null}
              {parseError ? <Text style={styles.errorText}>{parseError}</Text> : null}
            </View>

            {headers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>2) Match columns + choose fields</Text>
                {FIELD_ORDER.map((field) => {
                  const selected = selectedFields.has(field.key);
                  const required = !!field.required;
                  const selectedValue = mapping[field.key] ?? "__none__";
                  return (
                    <View key={field.key} style={styles.fieldRow}>
                      <View style={styles.fieldRowTop}>
                        <TouchableOpacity
                          onPress={() => handleToggleField(field.key)}
                          disabled={required}
                          style={styles.checkboxWrap}
                        >
                          <Ionicons
                            name={selected ? "checkbox" : "square-outline"}
                            size={18}
                            color={required || selected ? "#2563EB" : "#9CA3AF"}
                          />
                        </TouchableOpacity>
                        <Text style={styles.fieldLabel}>
                          {field.label}
                          {required ? " (required)" : ""}
                        </Text>
                      </View>
                      <View style={styles.pickerWrap}>
                        <Picker
                          selectedValue={selectedValue}
                          onValueChange={(value) =>
                            handleMappingChange(field.key, value === "__none__" ? null : value)
                          }
                          enabled={required || selected}
                        >
                          {!required && <Picker.Item label="Not mapped" value="__none__" />}
                          {headers.map((header) => (
                            <Picker.Item key={header} label={header} value={header} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                  );
                })}
                {customFields.length > 0 && (
                  <View style={styles.customFieldsSection}>
                    <Text style={styles.customFieldsTitle}>Community custom columns</Text>
                    {customFields.map((field) => {
                      const selected = selectedCustomSlots.has(field.slot);
                      const selectedValue = customFieldMapping[field.slot] ?? "__none__";
                      return (
                        <View key={field.slot} style={styles.fieldRow}>
                          <View style={styles.fieldRowTop}>
                            <TouchableOpacity
                              onPress={() => handleToggleCustomField(field.slot)}
                              style={styles.checkboxWrap}
                            >
                              <Ionicons
                                name={selected ? "checkbox" : "square-outline"}
                                size={18}
                                color={selected ? "#2563EB" : "#9CA3AF"}
                              />
                            </TouchableOpacity>
                            <Text style={styles.fieldLabel}>
                              {field.name} ({field.type})
                            </Text>
                          </View>
                          <View style={styles.pickerWrap}>
                            <Picker
                              selectedValue={selectedValue}
                              onValueChange={(value) =>
                                handleCustomMappingChange(
                                  field.slot,
                                  value === "__none__" ? null : value
                                )
                              }
                              enabled={selected}
                            >
                              <Picker.Item label="Not mapped" value="__none__" />
                              {headers.map((header) => (
                                <Picker.Item key={header} label={header} value={header} />
                              ))}
                            </Picker>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>3) Dry run preview</Text>
              <TouchableOpacity
                style={[styles.primaryButton, (!canPreview || isPreviewing) && styles.disabledButton]}
                onPress={handleRunPreview}
                disabled={!canPreview || isPreviewing}
              >
                {isPreviewing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Preview import</Text>
                )}
              </TouchableOpacity>
            </View>

            {previewResult && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Preview summary</Text>
                <View style={styles.summaryGrid}>
                  <Text style={styles.summaryItem}>Ready: {previewResult.summary.readyRows}</Text>
                  <Text style={styles.summaryItem}>Skipped: {previewResult.summary.skippedRows}</Text>
                  <Text style={styles.summaryItem}>Create users: {previewResult.summary.usersToCreate}</Text>
                  <Text style={styles.summaryItem}>Update users: {previewResult.summary.usersToUpdate}</Text>
                  <Text style={styles.summaryItem}>Add to community: {previewResult.summary.communityAdds}</Text>
                  <Text style={styles.summaryItem}>Add to group: {previewResult.summary.groupAdds}</Text>
                  <Text style={styles.summaryItem}>Follow-up creates: {previewResult.summary.followupCreates}</Text>
                  <Text style={styles.summaryItem}>Notes append/create: {previewResult.summary.notesAppends + previewResult.summary.notesCreates}</Text>
                  <Text style={styles.summaryItem}>Custom field updates: {previewResult.summary.customFieldUpdates}</Text>
                </View>

                {skippedRows.length > 0 && (
                  <View style={styles.skippedWrap}>
                    <Text style={styles.skippedTitle}>Skipped rows (first 20)</Text>
                    {skippedRows.map((row) => (
                      <Text key={row.rowNumber} style={styles.skippedRowText}>
                        Row {row.rowNumber}: {row.reasons.join(", ")}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isApplying || !previewResult || previewResult.summary.readyRows === 0) &&
                  styles.disabledButton,
              ]}
              onPress={handleApplyImport}
              disabled={isApplying || !previewResult || previewResult.summary.readyRows === 0}
            >
              {isApplying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Import ready rows</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 860,
    maxHeight: "90%",
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  iconButton: {
    padding: 6,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  customFieldsSection: {
    gap: 8,
    marginTop: 4,
  },
  customFieldsTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1F2937",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  primaryOutlineButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryOutlineButtonText: {
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "600",
  },
  mutedText: {
    fontSize: 12,
    color: "#6B7280",
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
  },
  fieldRow: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  fieldRowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkboxWrap: {
    padding: 2,
  },
  fieldLabel: {
    fontSize: 12,
    color: "#111827",
    fontWeight: "600",
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 6,
    overflow: "hidden",
  },
  primaryButton: {
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 140,
  },
  disabledButton: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  summaryItem: {
    fontSize: 12,
    color: "#374151",
    backgroundColor: "#F3F4F6",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  skippedWrap: {
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  skippedTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#991B1B",
  },
  skippedRowText: {
    fontSize: 12,
    color: "#7F1D1D",
  },
  footerRow: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#374151",
    fontSize: 12,
    fontWeight: "600",
  },
});

