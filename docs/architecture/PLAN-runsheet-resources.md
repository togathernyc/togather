# Implementation Plan: Runsheet Improvements & Resources Toolbar System

**Date:** 2026-02-04
**Status:** Planning

## Executive Summary

This plan covers two major feature areas:
1. **Runsheet Page Improvements** - UX polish and embed link support
2. **Resources Toolbar System** - New configurable "Resource" tool type for groups

---

## Part 1: Runsheet Page Improvements

### 1.1 Add Drag Indicator Line

**Problem:** The top of the runsheet is too tight and doesn't indicate it can be pulled down.

**Solution:** Add the same drag indicator pattern used in the explore page.

**Files to Modify:**
- `/apps/mobile/features/leader-tools/components/RunSheetScreen.tsx`

**Implementation:**
1. The runsheet is currently rendered as a full screen. To add a drag indicator, we need to:
   - Add a visual drag handle component at the very top of the content
   - Use the same styling as ExploreBottomSheet: `{ backgroundColor: '#D1D5DB', width: 40, height: 4 }`

2. Create a simple `DragIndicator` component or inline the style:
```typescript
// Add at the top of the scrollable content
<View style={styles.dragIndicatorContainer}>
  <View style={styles.dragIndicator} />
</View>

// Styles
dragIndicatorContainer: {
  alignItems: 'center',
  paddingVertical: 8,
},
dragIndicator: {
  backgroundColor: '#D1D5DB',
  width: 40,
  height: 4,
  borderRadius: 2,
}
```

**Estimate:** Small task, can be done independently.

---

### 1.2 Reduce Timing Margin

**Problem:** The margin at the side of runsheet timing is too large.

**Current Implementation (RunSheetScreen.tsx):**
```typescript
timeColumn: {
  width: 60,  // <- this may be too wide
  borderRightWidth: 1,
  borderRightColor: '#e5e5e5',
  marginRight: 12,  // <- this margin is mentioned as too large
}
```

**Solution:** Reduce the margins. Specific values to be determined through visual testing.

**Files to Modify:**
- `/apps/mobile/features/leader-tools/components/RunSheetScreen.tsx` - lines 1263-1277 (timeColumn styles)

**Suggested Changes:**
- Reduce `marginRight` from 12 to 8
- Optionally reduce `width` from 60 to 50 or 55
- Test on device to ensure readability

**Estimate:** Small task, can be done independently.

---

### 1.3 Embed Link Support (Spotify, Dropbox, Whimsical)

**Problem:** Links in runsheet notes should show rich previews like chat does, not just text links.

**Current State:**
- Dropbox videos already have a custom `DropboxVideoPlayer` component (lines 111-144)
- Regular URLs show as blue text links
- No OG tag preview system

**Solution:** Integrate the existing `useLinkPreview` hook and `LinkPreviewCard` component from chat.

**Files to Reference:**
- `/apps/mobile/features/chat/hooks/useLinkPreview.ts` - Hook for fetching OG previews
- `/apps/mobile/features/chat/components/LinkPreviewCard.tsx` - Preview card UI
- `/apps/convex/functions/linkPreview.ts` - Backend that already handles Spotify via oEmbed

**Files to Modify:**
- `/apps/mobile/features/leader-tools/components/RunSheetScreen.tsx`

**Implementation:**

#### Step 1: Add Special URL Detection

Create URL detection utilities in runsheet (or reuse from chat):
```typescript
// URL type detection
const isSpotifyUrl = (url: string) => url.includes('open.spotify.com');
const isWhimsicalUrl = (url: string) => url.includes('whimsical.com');
const isDropboxUrl = (url: string) => url.includes('dropbox.com');
const isVideoUrl = (url: string) => /\.(mp4|mov|avi|webm|mkv)/i.test(url);
```

#### Step 2: Create RunsheetLinkPreview Component

```typescript
// New component in RunSheetScreen.tsx or separate file
const RunsheetLinkPreview = ({ url }: { url: string }) => {
  const { preview, loading } = useLinkPreview(url);

  if (loading) {
    return <LinkPreviewCard loading />;
  }

  if (!preview) {
    return null; // Fallback to nothing, or could show raw link
  }

  return (
    <LinkPreviewCard
      preview={preview}
      embedded={true}
    />
  );
};
```

#### Step 3: Integrate in Note Rendering

In the `renderNoteContent` function (around line 181-232):
1. Extract URLs from note content
2. For each URL, determine type:
   - Dropbox video → Use existing `DropboxVideoPlayer`
   - Spotify → Use `RunsheetLinkPreview` (backend already handles oEmbed)
   - Whimsical → Use `RunsheetLinkPreview` (will use OG tags)
   - Other links → Use `RunsheetLinkPreview`
3. **Remove the raw link text when preview is shown**

```typescript
const renderNoteContent = (noteContent: string) => {
  const urls = extractUrls(noteContent);
  const textWithoutUrls = urls.length > 0 ? removeUrlsFromText(noteContent, urls) : noteContent;

  return (
    <View>
      {textWithoutUrls.trim() && <SelectableText>{textWithoutUrls}</SelectableText>}
      {urls.map((url, index) => (
        <View key={index} style={styles.linkPreviewContainer}>
          {isVideoUrl(url) || isDropboxUrl(url) ? (
            <DropboxVideoPlayer url={url} />
          ) : (
            <RunsheetLinkPreview url={url} />
          )}
        </View>
      ))}
    </View>
  );
};
```

#### Step 4: Whimsical Embed Consideration

Whimsical provides iframe embeds:
```html
<iframe style="border:none" width="800" height="450" src="https://whimsical.com/embed/XGotVEBoyCFZjxPdm9mz5A"></iframe>
```

For React Native, we cannot use iframes directly. Options:
1. **OG Preview + Open in Browser** (recommended) - Show OG card, tap opens in web browser
2. **WebView Embed** - Embed actual Whimsical content (more complex, performance concerns)

Recommendation: Use OG preview approach to match other links. Users tap to view in browser.

**Backend Update Needed:**
- Add Whimsical to oEmbed handling in `/apps/convex/functions/linkPreview.ts` if their OG tags are insufficient
- Whimsical URL pattern: `whimsical.com/embed/<id>` or `whimsical.com/<board-name>-<id>`

**Estimate:** Medium task, 2-3 hours.

---

### 1.4 Summary: Runsheet Tasks Breakdown

| Task ID | Task | Dependencies | Can Parallelize |
|---------|------|--------------|-----------------|
| RS-1 | Add drag indicator line | None | ✅ Yes |
| RS-2 | Reduce timing margin | None | ✅ Yes |
| RS-3 | Create RunsheetLinkPreview component | None | ✅ Yes |
| RS-4 | Integrate link preview in note rendering | RS-3 | After RS-3 |
| RS-5 | Remove raw link text when preview shown | RS-4 | After RS-4 |
| RS-6 | Test Spotify/Whimsical/Dropbox embeds | RS-4, RS-5 | After both |

**Parallelization:** RS-1, RS-2, and RS-3 can be done in parallel by different agents.

---

## Part 2: Resources Toolbar System

### 2.1 Feature Overview

Create a new "Resource" toolbar tool type that allows groups to create custom resource pages with:
- Unlimited sections
- Each section: title, optional description, optional image, optional link
- Links show OG tag previews
- Visibility predicates (everyone, joined in past X days/weeks/months)
- Custom toolbar item title (Welcome, Roles, Resources, New Here?, etc.)

### 2.2 Data Model Design

#### Schema Changes (`/apps/convex/schema.ts`)

```typescript
// New table: group_resources
export const groupResources = defineTable({
  groupId: v.id("groups"),
  title: v.string(),  // "Welcome", "Roles", "Resources", etc.
  icon: v.optional(v.string()),  // Ionicons icon name
  visibility: v.object({
    type: v.union(
      v.literal("everyone"),
      v.literal("joined_within")
    ),
    // For "joined_within" type:
    daysWithin: v.optional(v.number()),  // Show to users who joined within X days
  }),
  sections: v.array(v.object({
    id: v.string(),  // Unique ID for ordering/editing
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    linkUrl: v.optional(v.string()),
    order: v.number(),
  })),
  order: v.number(),  // Order in toolbar
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_group", ["groupId"]);
```

**Extensibility Note:** The `visibility` object is designed to be extended later:
```typescript
// Future extensions:
visibility: v.object({
  type: v.union(
    v.literal("everyone"),
    v.literal("joined_within"),
    v.literal("pco_role"),  // Future: Show to specific PCO roles
    v.literal("group_role"),  // Future: Show to leaders/members
  ),
  daysWithin: v.optional(v.number()),
  pcoRoles: v.optional(v.array(v.string())),  // Future
  groupRoles: v.optional(v.array(v.string())),  // Future
}),
```

#### Toolbar Integration

The existing toolbar system uses `TOOLBAR_TOOLS` constant for built-in tools. For dynamic resources:

1. **Option A:** Store resource IDs in `leaderToolbarTools` array with prefix (e.g., `resource:abc123`)
2. **Option B:** Create separate `resourceTools` array on groups table

**Recommendation:** Option A - keeps single source of truth for toolbar order.

Update `/apps/mobile/features/chat/constants/toolbarTools.ts`:
```typescript
// Add helper to detect resource tools
export const isResourceToolId = (toolId: string) => toolId.startsWith('resource:');
export const getResourceId = (toolId: string) => toolId.replace('resource:', '');
```

---

### 2.3 Backend Implementation

#### New File: `/apps/convex/functions/groupResources/index.ts`

```typescript
// Queries
export const listByGroup = query({...});  // Get all resources for a group
export const getById = query({...});       // Get single resource with sections
export const getVisibleForUser = query({...});  // Get resources visible to current user

// Mutations
export const create = mutation({...});      // Create new resource
export const update = mutation({...});      // Update resource (title, icon, visibility)
export const delete = mutation({...});      // Delete resource
export const addSection = mutation({...});  // Add section to resource
export const updateSection = mutation({...}); // Update section
export const deleteSection = mutation({...}); // Delete section
export const reorderSections = mutation({...}); // Reorder sections
export const reorderResources = mutation({...}); // Reorder resources in toolbar
```

#### Visibility Logic (`getVisibleForUser`)

```typescript
const getVisibleForUser = query({
  args: { groupId: v.id("groups"), token: v.string() },
  handler: async (ctx, { groupId, token }) => {
    const user = await authenticateUser(ctx, token);
    const membership = await getMembership(ctx, groupId, user._id);

    const allResources = await ctx.db
      .query("groupResources")
      .withIndex("by_group", q => q.eq("groupId", groupId))
      .collect();

    return allResources.filter(resource => {
      const { type, daysWithin } = resource.visibility;

      if (type === "everyone") return true;

      if (type === "joined_within" && daysWithin) {
        const joinedAt = membership.createdAt;
        const daysSinceJoined = (Date.now() - joinedAt) / (1000 * 60 * 60 * 24);
        return daysSinceJoined <= daysWithin;
      }

      return false;
    });
  },
});
```

---

### 2.4 Frontend Implementation

#### New Files Structure

```
/apps/mobile/features/leader-tools/
├── components/
│   ├── ResourceToolSettings.tsx      # Settings page for a single resource
│   ├── ResourceSectionEditor.tsx     # Edit individual section
│   └── ResourcesListSettings.tsx     # List all resources in toolbar settings
├── screens/
│   └── ResourcePage.tsx              # Display resource to users
```

#### Route Updates

Add new routes in `/apps/mobile/app/(user)/leader-tools/[group_id]/`:
```
resources/
├── index.tsx                         # List resources for configuration
├── [resource_id].tsx                 # Edit single resource
└── new.tsx                           # Create new resource
```

Add user-facing route:
```
/apps/mobile/app/(user)/group/[group_id]/resource/[resource_id].tsx
```

---

### 2.5 Toolbar Settings Integration

Update `/apps/mobile/app/(user)/leader-tools/[group_id]/toolbar-settings.tsx`:

1. Add "Resources" section at the bottom
2. Show list of created resources with add/edit/delete options
3. Resources can be toggled on/off in toolbar (same as built-in tools)
4. Resources can be reordered with other tools

**UI Mockup:**
```
┌─────────────────────────────────────┐
│ Toolbar Settings                    │
├─────────────────────────────────────┤
│ Tools                               │
│ ├── ☑ Attendance        [⚙️] [↑↓]  │
│ ├── ☑ Follow-up         [⚙️] [↑↓]  │
│ ├── ☑ Run Sheet         [⚙️] [↑↓]  │
│ └── ☑ Welcome (Resource) [⚙️] [↑↓]│
├─────────────────────────────────────┤
│ Resources                    [+ Add]│
│ ├── Welcome (visible to new users)  │
│ ├── Roles (visible to everyone)     │
│ └── Onboarding (visible to new...)  │
└─────────────────────────────────────┘
```

---

### 2.6 Resource Settings Page

`ResourceToolSettings.tsx` should include:

1. **Title Input** - Name of the resource (Welcome, Roles, etc.)
2. **Icon Picker** - Select Ionicons icon
3. **Visibility Settings**
   - Radio: "Everyone" or "People who joined within..."
   - If "joined within": Number input + Unit picker (days/weeks/months)
4. **Sections List**
   - Reorderable list of sections
   - Each section shows: title, preview of content
   - Edit/delete buttons
   - "Add Section" button at bottom

**Section Editor:**
```
┌─────────────────────────────────────┐
│ Edit Section                        │
├─────────────────────────────────────┤
│ Title*: [________________]          │
│ Description: [________________]     │
│              [________________]     │
│ Image: [Upload] or [URL]           │
│ Link URL: [________________]       │
│                                     │
│ Link Preview:                       │
│ ┌─────────────────────────────────┐│
│ │ 🎵 Spotify Playlist             ││
│ │ Sunday Morning Worship Mix      ││
│ └─────────────────────────────────┘│
│                                     │
│ [Cancel]              [Save Section]│
└─────────────────────────────────────┘
```

---

### 2.7 Resource Display Page

`ResourcePage.tsx` - The user-facing page showing the resource content:

```typescript
const ResourcePage = () => {
  const { resource_id } = useLocalSearchParams();
  const resource = useQuery(api.functions.groupResources.getById, { resourceId });

  return (
    <ScrollView>
      <View style={styles.header}>
        <Ionicons name={resource.icon} size={24} />
        <Text style={styles.title}>{resource.title}</Text>
      </View>

      {resource.sections.map(section => (
        <ResourceSection key={section.id} section={section} />
      ))}
    </ScrollView>
  );
};

const ResourceSection = ({ section }) => {
  const { preview } = useLinkPreview(section.linkUrl);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.description && (
        <Text style={styles.sectionDescription}>{section.description}</Text>
      )}
      {section.imageUrl && (
        <Image source={{ uri: section.imageUrl }} style={styles.sectionImage} />
      )}
      {section.linkUrl && preview && (
        <Pressable onPress={() => Linking.openURL(section.linkUrl)}>
          <LinkPreviewCard preview={preview} />
        </Pressable>
      )}
    </View>
  );
};
```

---

### 2.8 Toolbar Rendering Updates

Update `/apps/mobile/features/chat/components/ChatNavigation.tsx`:

1. Detect resource tool IDs (`resource:xxx`)
2. Fetch resource metadata for icon/title
3. Apply visibility filtering based on user's join date

```typescript
const ChatToolbar = ({ tools, ... }) => {
  // Fetch resource data for resource tools
  const resourceIds = tools?.filter(isResourceToolId).map(getResourceId);
  const resources = useQuery(
    api.functions.groupResources.getVisibleForUser,
    resourceIds?.length ? { groupId, token } : "skip"
  );

  // Combine built-in tools with resources
  const allTools = tools?.map(toolId => {
    if (isResourceToolId(toolId)) {
      const resource = resources?.find(r => r._id === getResourceId(toolId));
      if (!resource) return null; // Hidden by visibility rules
      return {
        id: toolId,
        icon: resource.icon || 'document-outline',
        label: resource.title,
      };
    }
    return TOOLBAR_TOOLS[toolId];
  }).filter(Boolean);

  // ... render tools
};
```

---

### 2.9 Summary: Resources Tasks Breakdown

| Task ID | Task | Dependencies | Can Parallelize |
|---------|------|--------------|-----------------|
| RES-1 | Add schema for groupResources table | None | ✅ Yes |
| RES-2 | Create backend queries/mutations | RES-1 | After RES-1 |
| RES-3 | Add resource routes to mobile app | None | ✅ Yes |
| RES-4 | Build ResourceToolSettings component | RES-2 | After RES-2 |
| RES-5 | Build ResourceSectionEditor component | None | ✅ Yes |
| RES-6 | Build ResourcePage display component | RES-2, RES-5 | After both |
| RES-7 | Update toolbar-settings.tsx | RES-2, RES-4 | After both |
| RES-8 | Update ChatNavigation for resources | RES-2 | After RES-2 |
| RES-9 | Integrate LinkPreviewCard in resources | None | ✅ Yes |
| RES-10 | Test visibility predicates | RES-2, RES-6 | After both |
| RES-11 | Test end-to-end flow | All | After all |

**Parallelization:**
- **Wave 1 (Parallel):** RES-1, RES-3, RES-5, RES-9
- **Wave 2 (Parallel):** RES-2, RES-4 (after Wave 1)
- **Wave 3 (Parallel):** RES-6, RES-7, RES-8 (after Wave 2)
- **Wave 4:** RES-10, RES-11 (testing)

---

## Part 3: Agent Instructions

### For Any Agent Picking Up This Work

1. **Read this entire plan first** to understand the full scope
2. **Check the task dependencies** before starting any task
3. **Parallelize aggressively** - spawn subagents for independent tasks
4. **Commit frequently** - make atomic commits after each logical change
5. **Test visually** - use Playwright or device testing for UI changes

### Spawning Subagents

When implementing, the orchestrator should spawn parallel subagents:

```
// Wave 1 - Start all independent tasks
Task("Implement RS-1: Add drag indicator to runsheet", subagent_type="general-purpose")
Task("Implement RS-2: Reduce timing margin in runsheet", subagent_type="general-purpose")
Task("Implement RS-3: Create RunsheetLinkPreview component", subagent_type="general-purpose")
Task("Implement RES-1: Add groupResources schema", subagent_type="general-purpose")
Task("Implement RES-3: Add resource routes", subagent_type="general-purpose")
Task("Implement RES-5: Build ResourceSectionEditor", subagent_type="general-purpose")
Task("Implement RES-9: Prepare LinkPreviewCard for resources", subagent_type="general-purpose")

// Wave 2 - After schema is done
Task("Implement RES-2: Create backend queries/mutations", subagent_type="general-purpose")
Task("Implement RS-4: Integrate link preview in runsheet", subagent_type="general-purpose")

// Wave 3 - After backend is done
Task("Implement RES-6: Build ResourcePage", subagent_type="general-purpose")
Task("Implement RES-7: Update toolbar settings", subagent_type="general-purpose")
Task("Implement RES-8: Update ChatNavigation", subagent_type="general-purpose")
```

### Key Files Reference

**Runsheet:**
- `/apps/mobile/features/leader-tools/components/RunSheetScreen.tsx`
- `/apps/mobile/features/chat/hooks/useLinkPreview.ts`
- `/apps/mobile/features/chat/components/LinkPreviewCard.tsx`

**Toolbar:**
- `/apps/mobile/features/chat/constants/toolbarTools.ts`
- `/apps/mobile/features/chat/components/ChatNavigation.tsx`
- `/apps/mobile/app/(user)/leader-tools/[group_id]/toolbar-settings.tsx`

**Backend:**
- `/apps/convex/schema.ts`
- `/apps/convex/functions/groups/mutations.ts`
- `/apps/convex/functions/linkPreview.ts`

---

## Part 4: Testing Plan

### Runsheet Testing
1. Open runsheet page
2. Verify drag indicator is visible at top
3. Verify timing margins look better (not too wide)
4. Add a test note with Spotify link - verify preview appears
5. Add a test note with Whimsical link - verify preview appears
6. Add a test note with Dropbox video - verify video player appears
7. Verify raw link text is hidden when preview is shown

### Resources Testing
1. Create a new resource in toolbar settings
2. Add sections with text, images, and links
3. Verify link previews load correctly
4. Test visibility: create resource for "joined within 7 days"
5. Verify resource appears for new members
6. Verify resource doesn't appear for old members
7. Test reordering resources in toolbar
8. Test resource display page renders correctly

### Test Credentials
- Phone: `2025550123` (code: `000000`)
- Community: "Demo Community"

---

## Appendix: API Contract Additions

### New Convex Functions

```typescript
// /apps/convex/functions/groupResources/index.ts

// Queries
api.functions.groupResources.listByGroup({ groupId, token })
api.functions.groupResources.getById({ resourceId, token })
api.functions.groupResources.getVisibleForUser({ groupId, token })

// Mutations
api.functions.groupResources.create({ groupId, title, icon, visibility, token })
api.functions.groupResources.update({ resourceId, title?, icon?, visibility?, token })
api.functions.groupResources.delete({ resourceId, token })
api.functions.groupResources.addSection({ resourceId, section, token })
api.functions.groupResources.updateSection({ resourceId, sectionId, section, token })
api.functions.groupResources.deleteSection({ resourceId, sectionId, token })
api.functions.groupResources.reorderSections({ resourceId, sectionIds, token })
```

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-02-04 | Initial plan created | Claude |
