import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { EditorModal } from "../primitives";
import { styles } from "../styles";

/**
 * Searchable list in a page sheet — the Slack member, mention and channel
 * pickers are all this with different rows.
 */
export function SearchPickerModal<T extends { id: string }>({
  title,
  closeLabel,
  placeholder,
  items,
  isLoading,
  matches,
  primaryText,
  secondaryText,
  right,
  isDisabled,
  isHighlighted,
  onSelect,
  onClose,
}: {
  title: string;
  closeLabel: string;
  placeholder: string;
  items: T[];
  isLoading: boolean;
  matches: (item: T, query: string) => boolean;
  primaryText: (item: T) => string;
  secondaryText?: (item: T) => string;
  right?: (item: T) => React.ReactNode;
  isDisabled?: (item: T) => boolean;
  isHighlighted?: (item: T) => boolean;
  onSelect: (item: T) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((item) => matches(item, q)) : items;
  }, [items, search, matches]);

  return (
    <EditorModal visible title={title} onClose={onClose} closeLabel={closeLabel} scroll={false}>
      <View style={[styles.searchBar, { backgroundColor: colors.surfaceSecondary }]}>
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={primaryColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const disabled = isDisabled?.(item) ?? false;
            const highlighted = isHighlighted?.(item) ?? false;
            return (
              <TouchableOpacity
                style={[styles.pickerRow, { borderBottomColor: colors.border }]}
                onPress={() => onSelect(item)}
                disabled={disabled}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.pickerName,
                      { color: disabled ? colors.textTertiary : highlighted ? primaryColor : colors.text },
                      highlighted && { fontWeight: "600" },
                    ]}
                  >
                    {primaryText(item)}
                  </Text>
                  {secondaryText && (
                    <Text style={[styles.pickerSubtext, { color: colors.textTertiary }]}>
                      {secondaryText(item)}
                    </Text>
                  )}
                </View>
                {right?.(item)}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.emptyListText, { color: colors.textTertiary }]}>
              {search ? "No matches" : "Nothing found"}
            </Text>
          }
        />
      )}
    </EditorModal>
  );
}
