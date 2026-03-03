# Custom Channels - Simulator Testing Checklist

## Prerequisites
- [ ] App is running (`pnpm dev`)
- [ ] Convex backend is running
- [ ] Logged in with test credentials: Phone `2025550123`, Code `000000`
- [ ] Joined "Demo Community"

---

## 1. Navigation & Routes

### 1.1 Channel Access via Inbox
- [ ] Open Inbox tab
- [ ] Tap on a group to see channel list
- [ ] General channel shows and is accessible
- [ ] Leaders channel shows for leader users
- [ ] URL uses slug format (e.g., `/inbox/[groupId]/general`)

### 1.2 Deep Link Routes
- [ ] `/inbox/[groupId]/general` - Opens General channel
- [ ] `/inbox/[groupId]/leaders` - Opens Leaders channel
- [ ] `/inbox/[groupId]/[custom-slug]` - Opens custom channel (after creating one)

---

## 2. Channel Creation (Leaders Only)

### 2.1 Access Create Screen
- [ ] Navigate to group detail page
- [ ] Scroll to Channels section
- [ ] "+ Create Channel" button visible (leader only)
- [ ] Tap button → Opens create channel screen

### 2.2 Create Channel Form
- [ ] "Create Channel" header displayed
- [ ] Channel name input field present
- [ ] Character counter shows (e.g., "0/50")
- [ ] "Channel names cannot be changed after creation" warning visible
- [ ] Description field (optional) present
- [ ] Create button disabled when name is empty

### 2.3 Validation
- [ ] Typing name enables Create button
- [ ] Character count updates as you type
- [ ] Cannot exceed 50 characters

### 2.4 Channel Creation
- [ ] Enter channel name "Test Directors"
- [ ] Optionally add description
- [ ] Tap Create
- [ ] Loading state shown
- [ ] Navigates to new channel on success
- [ ] Channel appears in channels list with slug "test-directors"

### 2.5 Error Handling
- [ ] Non-leader cannot see Create button
- [ ] Shows error if creation fails

---

## 3. Members Management

### 3.1 Access Members Screen
- [ ] Navigate to a custom channel chat
- [ ] Tap channel header or "Manage" button
- [ ] Members screen opens

### 3.2 Members List
- [ ] Shows all channel members
- [ ] Displays avatars and names
- [ ] Owner has "Owner" badge
- [ ] Current user shows "(you)" indicator

### 3.3 Add Members (Owner/Leader Only)
- [ ] "+ Add" button visible for authorized users
- [ ] Tap opens member picker modal
- [ ] Shows only group members not in channel
- [ ] Can select multiple members
- [ ] "Add (N)" button shows count
- [ ] Adding members works

### 3.4 Remove Members (Owner/Leader Only)
- [ ] Remove button visible for each member
- [ ] Confirmation dialog appears
- [ ] Member is removed after confirmation

### 3.5 Archive Channel
- [ ] Archive button visible at bottom (owner/leader only)
- [ ] Confirmation dialog appears
- [ ] Channel is archived
- [ ] Navigates away after archive

---

## 4. Channels Section on Group Page

### 4.1 Section Visibility
- [ ] Navigate to any group detail page
- [ ] Scroll to find "Channels" section
- [ ] Shows "AUTO CHANNELS" header

### 4.2 Auto Channels
- [ ] General channel row visible
- [ ] Shows "All members" or member count
- [ ] Leaders channel visible (for leaders)
- [ ] Toggle switch for leaders channel (leader only)

### 4.3 Custom Channels
- [ ] "CUSTOM CHANNELS" header visible (if any exist)
- [ ] Lists channels user is member of
- [ ] Shows channel name and member count
- [ ] Leave button visible

### 4.4 Leave Channel
- [ ] Tap Leave on a custom channel
- [ ] Confirmation dialog appears
- [ ] Channel removed from list after leaving

### 4.5 Toggle Leaders Channel
- [ ] Leader sees toggle switch
- [ ] Toggling off disables leaders channel
- [ ] Toggling on re-enables it

### 4.6 Navigation
- [ ] Tap channel row → Opens channel chat
- [ ] Tap Manage → Opens members screen
- [ ] Tap Create → Opens create screen

---

## 5. Leave Channel Flow

### 5.1 Leave Custom Channel
- [ ] Open a custom channel you're a member of
- [ ] Find leave option (in Channels section or header menu)
- [ ] Confirm leave
- [ ] Successfully removed from channel

### 5.2 Cannot Leave Auto Channels
- [ ] Try to leave General channel
- [ ] Shows helpful error about leaving group
- [ ] Try to leave Leaders channel
- [ ] Shows helpful error about role change

---

## 6. Edge Cases

### 6.1 Owner Leaving
- [ ] As owner, leave channel with other members
- [ ] Oldest member becomes new owner

### 6.2 Last Member Leaving
- [ ] Leave channel when you're the only member
- [ ] Channel should be archived

### 6.3 Unread Counts
- [ ] Custom channels show unread badge when messages received
- [ ] Badge clears when channel is opened

---

## 7. Permissions

### 7.1 Leader Permissions
- [ ] Leaders see Create Channel button
- [ ] Leaders see Manage button on channels
- [ ] Leaders can add/remove members
- [ ] Leaders can archive channels

### 7.2 Member Permissions
- [ ] Members don't see Create button
- [ ] Members don't see Manage button
- [ ] Members can leave custom channels
- [ ] Members see read-only member list

---

## Test Results

| Test Area | Status | Notes |
|-----------|--------|-------|
| Navigation | | |
| Channel Creation | | |
| Members Management | | |
| Channels Section | | |
| Leave Channel | | |
| Edge Cases | | |
| Permissions | | |

---

## Issues Found

1.
2.
3.

---

## Sign-off

- Tester: _____________
- Date: _____________
- Build: _____________
