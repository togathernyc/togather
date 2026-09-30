import React, { useState } from "react";
import { Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { PcoRoleMapping, ServicePlanItemV2 } from "../../hooks/useSlackBotConfig";
import { PLAN_ITEM_ACTIONS, planItemActionColor } from "./constants";
import { Badge, Card, Divider, Section, SmallButton } from "./primitives";
import { styles } from "./styles";
import type { SlackBotConfig } from "./types";

/**
 * Setup that rarely changes once the bot is working — collapsed by default so
 * the everyday controls (campuses, schedule, team) aren't buried under it.
 */
export function AdvancedSection({
  config,
  planItems,
  onAddItem,
  onEditItem,
  onRemoveItem,
  onEditPco,
  onEditAi,
  onToggleDevMode,
}: {
  config: SlackBotConfig;
  planItems: ServicePlanItemV2[];
  onAddItem: () => void;
  onEditItem: (index: number) => void;
  onRemoveItem: (index: number) => void;
  onEditPco: () => void;
  onEditAi: () => void;
  onToggleDevMode: () => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Advanced</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textTertiary }]}>
            What the bot tracks, Planning Center, AI prompts, dev mode
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      {open && (
        <View style={{ marginTop: -12, marginHorizontal: -16 }}>
          <Section
            title="What the bot tracks"
            subtitle="Each item it asks about in the thread, and what it does in Planning Center once someone answers"
            action={<SmallButton icon="add" label="Add" onPress={onAddItem} />}
          >
            <Card>
              {planItems.length === 0 ? (
                <Text style={[styles.emptyCardText, { color: colors.textTertiary }]}>
                  Nothing tracked yet. Tap Add to create an item.
                </Text>
              ) : (
                planItems.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 && <Divider />}
                    <View style={styles.row}>
                      <TouchableOpacity style={styles.rowLeft} onPress={() => onEditItem(index)}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.rowLabel, { color: colors.text, fontWeight: "500" }]}>
                            {item.label}
                          </Text>
                          <Text style={[styles.rowDetail, { color: colors.textTertiary }]}>
                            {item.responsibleRoles.join(", ") || "no roles"}
                          </Text>
                        </View>
                        <Badge
                          label={PLAN_ITEM_ACTIONS.find((a) => a.key === item.actionType)?.badge ?? "Track"}
                          color={planItemActionColor(item.actionType, colors)}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconButton}
                        onPress={() => onRemoveItem(index)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Remove ${item.label}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </Section>

          <Section
            title="Planning Center"
            action={<SmallButton icon="pencil" label="Edit" onPress={onEditPco} />}
          >
            <Card onPress={onEditPco}>
              {Object.entries(config.pcoConfig.serviceTypeIds as Record<string, string>).map(
                ([location, typeId], index) => (
                  <View key={location}>
                    {index > 0 && <Divider />}
                    <View style={styles.configRow}>
                      <Text style={[styles.configLabel, { color: colors.textSecondary }]}>
                        {location} service type
                      </Text>
                      <Text style={[styles.configValue, { color: colors.text }]}>{typeId}</Text>
                    </View>
                  </View>
                ),
              )}
              {Object.entries(config.pcoConfig.roleMappings as Record<string, PcoRoleMapping>).map(
                ([role, mapping]) => (
                  <View key={role}>
                    <Divider />
                    <View style={styles.configRow}>
                      <Text style={[styles.configLabel, { color: colors.textSecondary }]}>{role}</Text>
                      <Text style={[styles.configValueSmall, { color: colors.text }]}>
                        {mapping.teamNamePattern} · {mapping.positionName}
                      </Text>
                    </View>
                  </View>
                ),
              )}
            </Card>
          </Section>

          <Section title="AI prompts" action={<SmallButton icon="pencil" label="Edit" onPress={onEditAi} />}>
            <Card onPress={onEditAi}>
              <View style={styles.configRow}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Model</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>{config.aiConfig.model}</Text>
              </View>
              <Divider />
              <View style={styles.configRow}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Personality</Text>
                <Text style={[styles.configValueSmall, { color: colors.text }]} numberOfLines={3}>
                  {config.aiConfig.botPersonality}
                </Text>
              </View>
              <Divider />
              <View style={styles.configRow}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Response rules</Text>
                <Text style={[styles.configValueSmall, { color: colors.text }]} numberOfLines={3}>
                  {config.aiConfig.responseRules}
                </Text>
              </View>
            </Card>
          </Section>

          <Section title="Developer">
            <Card>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Ionicons
                    name="bug-outline"
                    size={18}
                    color={config.devMode ? colors.warning : colors.iconSecondary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.text }]}>Dev mode</Text>
                    <Text style={[styles.rowDetail, { color: colors.textTertiary }]}>
                      Skips scheduled threads and reminders on this deployment
                    </Text>
                  </View>
                </View>
                <Switch
                  value={config.devMode}
                  onValueChange={onToggleDevMode}
                  trackColor={{ true: colors.warning }}
                  accessibilityLabel="Dev mode"
                />
              </View>
            </Card>
          </Section>
        </View>
      )}
    </View>
  );
}
