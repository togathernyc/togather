/**
 * SlackBotConfigScreen - Admin page for the Slack service planning bot.
 *
 * Laid out by how often each thing changes: the bot's status and one-line
 * summary first, then a card per campus (with its weekly-thread switch), the
 * thread schedule and reminders, the team, a manual reminder, and finally the
 * rarely touched setup (tracked items, Planning Center, AI prompts, dev mode)
 * collapsed under Advanced. Sections and editors live in ./slackbot/.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import {
  useSlackBotConfig,
  sanitizeV2Item,
  type ServicePlanItemV2,
  type SlackBotNagEntry,
  type SlackBotTeamMember,
  type SlackChannel,
  type SlackMember,
} from "../hooks/useSlackBotConfig";
import { AdvancedSection } from "./slackbot/AdvancedSection";
import { CampusesSection } from "./slackbot/CampusesSection";
import { AVAILABLE_LOCATIONS, isLocationOn } from "./slackbot/constants";
import { AiConfigEditorModal } from "./slackbot/modals/AiConfigEditorModal";
import { MemberEditorModal } from "./slackbot/modals/MemberEditorModal";
import { PcoEditorModal } from "./slackbot/modals/PcoEditorModal";
import { PlanItemEditorModal } from "./slackbot/modals/PlanItemEditorModal";
import { ReminderEditorModal } from "./slackbot/modals/ReminderEditorModal";
import { SearchPickerModal } from "./slackbot/modals/SearchPickerModal";
import { OverviewCard } from "./slackbot/OverviewCard";
import { getV2Items } from "./slackbot/planItems";
import { RemindersSection, ThreadScheduleSection } from "./slackbot/ScheduleSection";
import { SendReminderSection } from "./slackbot/SendReminderSection";
import { styles } from "./slackbot/styles";
import { TeamSection } from "./slackbot/TeamSection";
import { confirmDestructive, showError } from "./slackbot/types";

type Picker = { kind: "addMember" } | { kind: "mentions"; location: string } | { kind: "channel" } | null;

const matchesMember = (m: SlackMember, q: string) =>
  m.realName.toLowerCase().includes(q) ||
  m.displayName.toLowerCase().includes(q) ||
  m.name.toLowerCase().includes(q);

const matchesChannel = (c: SlackChannel, q: string) => c.name.toLowerCase().includes(q);

export function SlackBotConfigScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const {
    config,
    isLoading,
    communityId,
    toggleBot,
    setLocationEnabled,
    toggleDevMode,
    updateTeamMembers,
    updateThreadMentions,
    updateNagSchedule,
    updatePrompts,
    updatePcoConfig,
    updateServicePlanItems,
    updateThreadCreation,
    updateSlackChannelId,
    slackMembers,
    isLoadingMembers,
    fetchSlackMembers,
    slackChannels,
    isLoadingChannels,
    fetchSlackChannels,
    pcoTeams,
    pcoPlanItemTitles,
    isLoadingPcoData,
    fetchPcoTeamsAndItems,
    sendNag,
  } = useSlackBotConfig();

  const [isToggling, setIsToggling] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [editingMember, setEditingMember] = useState<SlackBotTeamMember | null>(null);
  const [editingReminder, setEditingReminder] = useState<{ index: number | null; entry: SlackBotNagEntry } | null>(null);
  const [editingItem, setEditingItem] = useState<{ index: number | null; item: ServicePlanItemV2 } | null>(null);
  const [editingAi, setEditingAi] = useState(false);
  const [editingPco, setEditingPco] = useState(false);

  // Eagerly load channel names so the current channel ID can be shown as #name
  useEffect(() => {
    if (config && slackChannels.length === 0) fetchSlackChannels();
  }, [config, slackChannels.length, fetchSlackChannels]);

  const runningLocations = useMemo(
    () => AVAILABLE_LOCATIONS.filter((l) => isLocationOn(config?.locationsEnabled, l)),
    [config],
  );
  const planItems = useMemo(() => getV2Items(config), [config]);

  const channelName = useMemo(() => {
    if (!config) return "";
    const channel = slackChannels.find((ch) => ch.id === config.slackChannelId);
    return channel ? `#${channel.name}` : config.slackChannelId;
  }, [config, slackChannels]);

  const resolveSlackName = useCallback(
    (slackUserId: string): string => {
      const member = slackMembers.find((m) => m.id === slackUserId);
      if (member) return member.realName;
      const teamMember = config?.teamMembers.find((m: SlackBotTeamMember) => m.slackUserId === slackUserId);
      return teamMember?.name ?? slackUserId.slice(0, 8);
    },
    [slackMembers, config],
  );

  /** Run a mutation, reporting failure; resolves true on success. */
  const save = useCallback(async (run: () => Promise<unknown>, failure: string) => {
    try {
      await run();
      return true;
    } catch (error) {
      console.error(`[SlackBotConfig] ${failure}:`, error);
      showError(failure);
      return false;
    }
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  if (!config || !communityId) {
    return (
      <View style={styles.centered}>
        <Ionicons name="warning-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Slack bot not configured for this community.
        </Text>
        <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
          Run the seed script to set up initial configuration.
        </Text>
      </View>
    );
  }

  // ---- Handlers (config and communityId are loaded from here down) ----

  const handleToggleBot = async () => {
    setIsToggling(true);
    await save(() => toggleBot({ communityId, enabled: !config.enabled }), "Failed to turn the bot on or off");
    setIsToggling(false);
  };

  const handleSaveMember = async (member: SlackBotTeamMember) => {
    const members = [...config.teamMembers];
    const existing = members.findIndex((m: SlackBotTeamMember) => m.slackUserId === member.slackUserId);
    if (existing >= 0) members[existing] = member;
    else members.push(member);
    if (await save(() => updateTeamMembers({ communityId, teamMembers: members }), "Failed to save team member")) {
      setEditingMember(null);
    }
  };

  const handleRemoveMember = (member: SlackBotTeamMember) =>
    confirmDestructive("Remove member", `Remove ${member.name} from the team?`, () =>
      save(
        () =>
          updateTeamMembers({
            communityId,
            teamMembers: config.teamMembers.filter((m: SlackBotTeamMember) => m.slackUserId !== member.slackUserId),
          }),
        "Failed to remove member",
      ),
    );

  const handleToggleMention = (location: string, slackUserId: string) => {
    const current: string[] = config.threadMentions[location] ?? [];
    const next = current.includes(slackUserId)
      ? current.filter((id) => id !== slackUserId)
      : [...current, slackUserId];
    save(
      () => updateThreadMentions({ communityId, threadMentions: { ...config.threadMentions, [location]: next } }),
      "Failed to update who's tagged",
    );
  };

  const handleSaveReminder = async (entry: SlackBotNagEntry) => {
    if (!editingReminder) return;
    const schedule = [...config.nagSchedule];
    if (editingReminder.index !== null) schedule[editingReminder.index] = entry;
    else schedule.push(entry);
    if (await save(() => updateNagSchedule({ communityId, nagSchedule: schedule }), "Failed to save reminder")) {
      setEditingReminder(null);
    }
  };

  const handleRemoveReminder = (index: number) =>
    confirmDestructive("Remove reminder", `Remove "${config.nagSchedule[index]?.label ?? "this reminder"}"?`, () =>
      save(
        () =>
          updateNagSchedule({
            communityId,
            nagSchedule: config.nagSchedule.filter((_: SlackBotNagEntry, i: number) => i !== index),
          }),
        "Failed to remove reminder",
      ),
    );

  const handleOpenItemEditor = (index: number | null) => {
    fetchPcoTeamsAndItems();
    setEditingItem({
      index,
      item:
        index !== null
          ? planItems[index]
          : { id: "", label: "", responsibleRoles: [], actionType: "none" },
    });
  };

  const handleSaveItem = async (item: ServicePlanItemV2) => {
    if (!editingItem) return;
    const items = planItems.map(sanitizeV2Item);
    if (editingItem.index !== null) items[editingItem.index] = item;
    else items.push(item);
    if (await save(() => updateServicePlanItems({ communityId, items }), "Failed to save tracked item")) {
      setEditingItem(null);
    }
  };

  const handleRemoveItem = (index: number) =>
    confirmDestructive("Remove item", `Remove "${planItems[index]?.label ?? "this item"}"?`, () =>
      save(
        () =>
          updateServicePlanItems({
            communityId,
            items: planItems.filter((_, i) => i !== index).map(sanitizeV2Item),
          }),
        "Failed to remove tracked item",
      ),
    );

  const mentionLocation = picker?.kind === "mentions" ? picker.location : null;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <OverviewCard
          config={config}
          channelName={channelName}
          runningLocations={runningLocations}
          isToggling={isToggling}
          onToggleBot={handleToggleBot}
          onOpenActivity={() => router.push("/(user)/admin/slackbot/activity")}
        />

        <CampusesSection
          config={config}
          resolveSlackName={resolveSlackName}
          onToggleLocation={(location, enabled) =>
            save(() => setLocationEnabled({ communityId, location, enabled }), `Failed to update ${location}`)
          }
          onEditMentions={(location) => {
            fetchSlackMembers();
            setPicker({ kind: "mentions", location });
          }}
        />

        <ThreadScheduleSection
          config={config}
          channelName={channelName}
          onOpenChannelPicker={() => {
            fetchSlackChannels();
            setPicker({ kind: "channel" });
          }}
          onChangeDay={(dayOfWeek) =>
            save(
              () => updateThreadCreation({ communityId, threadCreation: { dayOfWeek, hourET: config.threadCreation.hourET } }),
              "Failed to update the thread day",
            )
          }
          onChangeHour={(hourET) =>
            save(
              () => updateThreadCreation({ communityId, threadCreation: { dayOfWeek: config.threadCreation.dayOfWeek, hourET } }),
              "Failed to update the thread time",
            )
          }
        />

        <RemindersSection
          nagSchedule={config.nagSchedule}
          onAdd={() =>
            setEditingReminder({ index: null, entry: { label: "", dayOfWeek: 3, hourET: 10, urgency: "gentle" } })
          }
          onEdit={(index) => setEditingReminder({ index, entry: config.nagSchedule[index] })}
          onRemove={handleRemoveReminder}
        />

        <TeamSection
          teamMembers={config.teamMembers}
          onAdd={() => {
            fetchSlackMembers();
            setPicker({ kind: "addMember" });
          }}
          onEdit={setEditingMember}
          onRemove={handleRemoveMember}
        />

        <SendReminderSection
          runningLocations={runningLocations}
          onSend={(location, urgency) => sendNag({ communityId, location, urgency })}
        />

        <AdvancedSection
          config={config}
          planItems={planItems}
          onAddItem={() => handleOpenItemEditor(null)}
          onEditItem={handleOpenItemEditor}
          onRemoveItem={handleRemoveItem}
          onEditPco={() => setEditingPco(true)}
          onEditAi={() => setEditingAi(true)}
          onToggleDevMode={() =>
            save(() => toggleDevMode({ communityId, devMode: !config.devMode }), "Failed to toggle dev mode")
          }
        />

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            Last updated{" "}
            {new Date(config.updatedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
      </ScrollView>

      {/* ---- Pickers ---- */}
      {picker?.kind === "addMember" && (
        <SearchPickerModal
          title="Add team member"
          closeLabel="Cancel"
          placeholder="Search Slack members..."
          items={slackMembers}
          isLoading={isLoadingMembers}
          matches={matchesMember}
          primaryText={(m) => m.realName}
          secondaryText={(m) => `@${m.name}`}
          isDisabled={(m) => config.teamMembers.some((t: SlackBotTeamMember) => t.slackUserId === m.id)}
          right={(m) =>
            config.teamMembers.some((t: SlackBotTeamMember) => t.slackUserId === m.id) ? (
              <Text style={[styles.addedBadge, { color: colors.textTertiary }]}>Added</Text>
            ) : null
          }
          onSelect={(m) => {
            setPicker(null);
            setEditingMember({ name: m.realName, slackUserId: m.id, roles: [], locations: [...AVAILABLE_LOCATIONS] });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {mentionLocation && (
        <SearchPickerModal
          title={`Tagged in ${mentionLocation} threads`}
          closeLabel="Done"
          placeholder="Search members..."
          items={slackMembers}
          isLoading={isLoadingMembers}
          matches={matchesMember}
          primaryText={(m) => m.realName}
          secondaryText={(m) => `@${m.name}`}
          right={(m) => {
            const tagged = (config.threadMentions[mentionLocation] ?? []).includes(m.id);
            return (
              <Ionicons
                name={tagged ? "checkmark-circle" : "ellipse-outline"}
                size={24}
                color={tagged ? primaryColor : colors.iconSecondary}
              />
            );
          }}
          onSelect={(m) => handleToggleMention(mentionLocation, m.id)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "channel" && (
        <SearchPickerModal
          title="Select channel"
          closeLabel="Cancel"
          placeholder="Search channels..."
          items={slackChannels}
          isLoading={isLoadingChannels}
          matches={matchesChannel}
          primaryText={(c) => `#${c.name}`}
          isHighlighted={(c) => c.id === config.slackChannelId}
          right={(c) =>
            c.id === config.slackChannelId ? (
              <Ionicons name="checkmark-circle" size={24} color={primaryColor} />
            ) : null
          }
          onSelect={(c) => {
            setPicker(null);
            save(() => updateSlackChannelId({ communityId, slackChannelId: c.id }), "Failed to update Slack channel");
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {/* ---- Editors ---- */}
      {editingMember && (
        <MemberEditorModal member={editingMember} onClose={() => setEditingMember(null)} onSave={handleSaveMember} />
      )}
      {editingReminder && (
        <ReminderEditorModal
          entry={editingReminder.entry}
          isNew={editingReminder.index === null}
          onClose={() => setEditingReminder(null)}
          onSave={handleSaveReminder}
        />
      )}
      {editingItem && (
        <PlanItemEditorModal
          item={editingItem.item}
          isNew={editingItem.index === null}
          pcoTeams={pcoTeams}
          pcoPlanItemTitles={pcoPlanItemTitles}
          isLoadingPcoData={isLoadingPcoData}
          onClose={() => setEditingItem(null)}
          onSave={handleSaveItem}
        />
      )}
      {editingAi && (
        <AiConfigEditorModal
          aiConfig={config.aiConfig}
          onClose={() => setEditingAi(false)}
          onSave={async (aiConfig) => {
            if (await save(() => updatePrompts({ communityId, aiConfig }), "Failed to save AI prompts")) {
              setEditingAi(false);
            }
          }}
        />
      )}
      {editingPco && (
        <PcoEditorModal
          pcoConfig={config.pcoConfig}
          onClose={() => setEditingPco(false)}
          onSave={async (pcoConfig) => {
            if (await save(() => updatePcoConfig({ communityId, pcoConfig }), "Failed to save Planning Center settings")) {
              setEditingPco(false);
            }
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
