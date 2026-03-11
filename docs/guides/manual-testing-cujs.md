# Manual Testing CUJ Guide

This guide documents Critical User Journeys (CUJs) for manual testing of the Togather app. Use these flows to verify features are working correctly after deployments or changes.

For the dedicated Tasks rollout matrix (task bot, reach out source flow, assignment lifecycle, permissions, realtime, migration), use `docs/testing/TASKS-CUJ-CHECKLIST.md`.

## Test Credentials

Use the test credentials from the seed script (`npx convex run functions/seed:seedDemoData`). The seed data creates test users with bypass OTP codes. Search for "Demo Community" when testing.

---

## CUJ 1: Authentication

### 1.1 Phone Login (New User)

**Steps:**

1. Open app at `http://localhost:8081`
2. Enter a new phone number
3. Tap "Continue"
4. Enter verification code (use `000000` for test numbers)
5. Tap "Verify"
6. Complete signup form (first name, last name, email, etc.)
7. Search for and select a community

**Expected:** Account created, redirected to Inbox

### 1.2 Phone Login (Existing User)

**Steps:**

1. Open app
2. Enter phone number: `2025550123`
3. Tap "Continue"
4. Enter code: `000000`
5. Select "FOUNT" community

**Expected:** Redirected to Inbox with existing data

### 1.3 Email Login

**Steps:**

1. Open app
2. Tap "Sign in with Email"
3. Enter your test email
4. Enter your test password
5. Tap "Sign In"
6. Select community if prompted

**Expected:** Redirected to Inbox

### 1.4 Password Reset

**Steps:**

1. On sign-in screen, tap "Forgot Password?"
2. Enter email address
3. Tap "Send Reset Link"
4. Check email for reset link
5. Click link and set new password

**Expected:** Password reset email sent, can login with new password

### 1.5 Logout

**Steps:**

1. Navigate to Profile tab
2. Tap "Log Out"
3. Confirm logout

**Expected:** Redirected to sign-in screen, session cleared

---

## CUJ 2: Explore & Discover Groups

### 2.1 Browse All Groups

**Steps:**

1. Navigate to Explore tab
2. View list of available groups
3. Scroll through groups

**Expected:** Groups display with name, type, image, and member count

### 2.2 Search Groups by Keyword

**Steps:**

1. On Explore tab, tap search bar
2. Enter group name or keyword
3. View filtered results

**Expected:** Only matching groups shown

### 2.3 Search Groups by Location (Map)

**Steps:**

1. On Explore tab, view the map
2. Drag/pan the map to a different area
3. View groups in the new map area

**Expected:** Groups update based on visible map region

### 2.4 Filter by Group Type

**Steps:**

1. On Explore tab, view group type filters
2. Tap on "Dinner Parties" filter
3. View only dinner party groups
4. Tap on "Teams" filter
5. View only team groups

**Expected:** Groups filtered by selected type

### 2.5 View Group Details

**Steps:**

1. Tap on any group card
2. View group detail page with:
   - Group name and description
   - Meeting schedule (day, time, cadence)
   - Location with map
   - Member list with leaders highlighted
   - Photo highlights gallery
   - Join/Leave button

**Expected:** All group information displays correctly

---

## CUJ 3: Join & Leave Groups

### 3.1 Request to Join Group

**Steps:**

1. Navigate to a group you're not a member of
2. View group details
3. Tap "Request to Join" button
4. Confirm request if prompted

**Expected:**

- Button changes to "Request Pending"
- Request sent to community admins

### 3.2 Cancel Join Request

**Steps:**

1. Navigate to a group with pending request
2. Tap "Cancel Request" button
3. Confirm cancellation

**Expected:** Request cancelled, button returns to "Request to Join"

### 3.3 Leave Group

**Steps:**

1. Navigate to a group you're a member of
2. Tap "Leave Group" button (or 3-dot menu → Leave)
3. Confirm leaving

**Expected:**

- Removed from group
- No longer appears in "My Groups"
- Button returns to "Request to Join"

### 3.4 View My Groups

**Steps:**

1. Navigate to Profile or Groups section
2. View "My Groups" list

**Expected:** All groups user is member of displayed

---

## CUJ 4: Chat & Messaging

### 4.1 View Inbox

**Steps:**

1. Navigate to Inbox tab
2. View list of conversations (group chats)

**Expected:**

- Conversations sorted by recent activity
- Unread indicators on new messages
- Preview of last message shown

### 4.2 Open Group Chat

**Steps:**

1. In Inbox, tap on a group conversation
2. View chat room

**Expected:**

- Message history loads
- Can see all participants
- Input field at bottom

### 4.3 Send Message

**Steps:**

1. Open any chat room
2. Tap message input field
3. Type a message
4. Tap send button

**Expected:** Message appears in chat, delivered to recipients

### 4.4 View Group Chat Options (3-Dot Menu)

**Steps:**

1. Open a group chat
2. Tap 3-dot menu in header
3. View available options:
   - Members
   - Events
   - Attendance (leaders only)
   - Group Page
   - Leave Group

**Expected:** Menu displays with correct options based on user role

### 4.5 Access Members from Chat

**Steps:**

1. Open a group chat
2. Tap 3-dot menu → "Members"
3. View list of all group members

**Expected:**

- All members displayed with role badges
- Leaders shown at top or highlighted
- Search and filter options available

### 4.6 Filter Members by Role

**Steps:**

1. From chat 3-dot menu, go to Members
2. Tap "Leaders" filter
3. View only leaders
4. Tap "Members" filter
5. View only regular members
6. Tap "All" to reset

**Expected:** List filters correctly, no infinite loading

### 4.7 Access Events from Chat

**Steps:**

1. Open a group chat
2. Tap 3-dot menu → "Events"
3. View list of past and upcoming events

**Expected:** Events displayed with dates

### 4.8 Access Attendance from Chat (Leaders Only)

**Steps:**

1. Login as a group leader
2. Open a group chat for a group you lead
3. Tap 3-dot menu → "Attendance"
4. View attendance tracking options

**Expected:**

- Attendance option visible only to leaders
- Can view/edit attendance for meetings

### 4.9 Track Attendance

**Steps:**

1. From chat 3-dot menu, tap "Attendance"
2. Select an event/date
3. View attendance form
4. Mark members as attended/absent
5. Add guest count if applicable
6. Save attendance

**Expected:** Attendance recorded and saved

### 4.10 View Attendance History

**Steps:**

1. In Attendance section, view past dates
2. Select a previous event
3. View recorded attendance

**Expected:** Historical attendance data displayed

### 4.11 Leaders Hub Chat (Leaders Only)

**Steps:**

1. Login as a group leader
2. Navigate to Inbox
3. Find a group you lead
4. Open the group chat

**Expected:**

- See both "General" and "Leaders Hub" channels
- Leaders Hub only visible to group leaders

### 4.12 Regular Member Chat View

**Steps:**

1. Login as regular member (not a leader)
2. Navigate to a group chat

**Expected:**

- See only "General" channel
- Leaders Hub NOT visible

---

## CUJ 5: Profile Management

### 5.1 View Profile

**Steps:**

1. Navigate to Profile tab
2. View profile information:
   - Profile photo
   - Name
   - Email
   - Phone number

**Expected:** All profile data displays correctly

### 5.2 Edit Profile Information

**Steps:**

1. On Profile tab, tap "Edit Profile"
2. Update fields (name, email, phone, etc.)
3. Tap "Save"

**Expected:** Changes saved and reflected in profile

### 5.3 Update Profile Photo

**Steps:**

1. On Profile/Edit screen, tap profile photo
2. Choose to upload new photo or take picture
3. Crop/adjust if needed
4. Save

**Expected:** New profile photo displayed throughout app

### 5.4 Remove Profile Photo

**Steps:**

1. On profile photo, tap remove/delete option
2. Confirm removal

**Expected:** Profile photo removed, default avatar shown

---

## CUJ 6: Admin Features

### 6.1 Access Admin Dashboard

**Steps:**

1. Login as community admin
2. Navigate to Admin tab

**Expected:** Admin dashboard with statistics and management options

### 6.2 View Pending Join Requests

**Steps:**

1. On Admin tab, view pending requests list
2. Each request shows:
   - User name and info
   - Group requesting to join
   - Current membership counts ("Member of: X dinner parties, Y teams")
     - Verify the correct number of membership counts show up, it should be equal to the number of group chats in the inbox tab

**Expected:** All pending requests displayed with user context

### 6.3 Approve Join Request

**Steps:**

1. Find a pending request
2. Tap "Approve"
3. Confirm if prompted

**Expected:**

- User added to group
- Request removed from pending list
- Success feedback shown
- User can see group chat immediately
- User shows up in members page

### 6.4 Decline Join Request

**Steps:**

1. Find a pending request
2. Tap "Decline"
3. Confirm if prompted

**Expected:**

- User NOT added to group
- Request removed from pending list

### 6.5 View User's Full History

**Steps:**

1. On a pending request, tap "View Full History"
2. Modal opens with user's complete group history

**Expected:**

- Shows all current memberships
- Shows past memberships (left groups)
- Shows previous requests (approved/declined)
- Dates for each action

### 6.6 Admin Approve Requests for Any Group

**Steps:**

1. As community admin, find request for any group
2. Approve or decline the request

**Expected:** Action succeeds - community admins can manage all groups

### 6.7 Promote Member to Leader (Admin Only)

**Steps:**

1. As community admin, go to Members page of any group (via chat 3-dot menu)
2. Tap on a regular member
3. Tap "Promote to Leader"

**Expected:**

- Member promoted to leader role
- Only community admins see this option (not group leaders)

### 6.8 Admin Self-Join Flow (Admin Requesting to Join a Group)

**Scenario:** Community admins may not be members of all groups but need to manage them. When they request to join, they can approve themselves.

**Steps:**

1. Login as community admin
2. Navigate to a group you are NOT a member of
3. Tap "Request to Join"
4. Go to Admin tab → Pending Requests
5. Find your own request
6. Tap "Approve"
7. Pull down to refresh the page (or navigate to Inbox and pull to refresh)

**Expected:**

- Request is approved successfully
- After refresh, group chat appears in Inbox
- User is now a member of the group
- Pull-to-refresh functionality works on relevant screens
- Consider showing a hint to pull-to-refresh after approval

### 6.9 Admin Edit Group Without Membership

**Scenario:** Admins should be able to edit any group even if they are not a member.

**Steps:**

1. Login as community admin
2. Navigate to a group you are NOT a member of
3. Tap 3-dot menu on group detail page
4. Tap "Edit Group" option

**Expected:**

- 3-dot menu is visible to admins on group detail page (even if not a member)
- "Edit Group" option is available in the menu
- Edit form opens and is prepopulated with existing data
- Changes can be saved successfully

### 6.10 Admin Manage Members Without Membership

**Scenario:** Admins should be able to view members and promote/demote leaders even for groups they are not a member of.

**Steps:**

1. Login as community admin
2. Navigate to a group you are NOT a member of
3. View the group detail page
4. Find and tap the "Members" section/link on the group detail page
5. View all group members
6. Tap on a regular member
7. Tap "Promote to Leader"
8. Verify member is promoted
9. Tap on a leader
10. Tap "Demote to Member"
11. Verify leader is demoted

**Expected:**

- Members section/link is visible on group detail page for admins
- Can view all members without being in the group
- Can promote members to leaders
- Can demote leaders to members
- Changes take effect immediately

---

## CUJ 7: Group Editing (Community Admins Only)

**Note:** Only community admins can edit groups. The edit form should be prepopulated with existing group data.

### 7.1 Access Group Edit

**Steps:**

1. Login as community admin
2. Navigate to any group's detail page
3. Tap "Edit" button

**Expected:**

- Edit screen opens
- All fields prepopulated with existing group data

### 7.2 Edit Basic Group Info

**Steps:**

1. On edit screen, verify name and description are prepopulated
2. Update name and description
3. Save changes

**Expected:** Changes saved and reflected in group detail

### 7.3 Edit Group Location

**Steps:**

1. In group edit, find Location section
2. Verify existing address is prepopulated
3. Update address fields
4. Save changes

**Expected:**

- Address updated
- Map reflects new location

### 7.4 Edit Meeting Schedule

**Steps:**

1. In group edit, find Meeting Schedule section
2. Verify existing schedule is prepopulated
3. Change day of week
4. Update start and end times
5. Toggle meeting type (In-Person / Online)
6. Add/update online meeting link
7. Save changes

**Expected:** All meeting schedule fields save correctly

### 7.5 Update Group Photos

**Steps:**

1. In group edit, find Photos section
2. View existing group photos (preview image and gallery)
3. Tap to update preview/main image
4. Add or remove gallery photos
5. Save changes

**Expected:**

- Can update main preview image
- Can manage photo gallery
- Changes reflected on group detail page

### 7.6 Update Max Capacity

**Steps:**

1. In group edit, find max capacity field
2. Verify existing capacity is prepopulated
3. Enter new number
4. Save changes

**Expected:** Capacity updated

### 7.7 Verify Non-Admin Cannot Edit

**Steps:**

1. Login as regular member or group leader (not community admin)
2. Navigate to a group's detail page
3. Look for "Edit" button

**Expected:** Edit button NOT visible for non-community-admins

---

## CUJ 8: Navigation & Back Behavior

### 8.1 Chat → Members → Back

**Steps:**

1. Open a group chat
2. Go to Members (via 3-dot menu)
3. Tap back button

**Expected:** Returns to chat room (not leader tools hub)

### 8.2 Chat → Group Page → Back

**Steps:**

1. Open a group chat
2. Tap 3-dot menu → "Group Page"
3. Tap back button

**Expected:** Returns to chat room

### 8.3 Chat → Events → Back

**Steps:**

1. Open a group chat
2. Tap 3-dot menu → "Events"
3. Tap back button

**Expected:** Returns to chat room

### 8.4 Chat → Attendance → Back

**Steps:**

1. Open a group chat (as leader)
2. Tap 3-dot menu → "Attendance"
3. Tap back button

**Expected:** Returns to chat room

### 8.5 Deep Link Navigation

**Steps:**

1. Navigate directly to a deep URL (e.g., `/groups/{id}`)
2. Tap back button

**Expected:** Falls back to logical parent screen

---

## CUJ 9: Error Handling

### 9.1 Network Error Recovery

**Steps:**

1. Disable network/wifi
2. Try to load data
3. Re-enable network
4. Pull to refresh

**Expected:** Error message shown, recovers when network restored

### 9.2 Failed API Request

**Steps:**

1. Trigger an API request that fails
2. View error handling

**Expected:** User-friendly error message, option to retry

### 9.3 View Full History Error

**Steps:**

1. Open View Full History modal
2. If API fails, verify behavior

**Expected:** Error message shown (not blank modal)

---

## Testing Checklist

### Authentication

- [x] Phone login (new user)
- [x] Phone login (existing user)
- [x] Email login
- [x] Password reset
- [x] Logout
- [x] Community selection

### Navigation

- [x] All navigation links work
- [x] Back buttons behave correctly
- [x] Chat → submenu → back returns to chat

### Groups

- [ ] Browse groups
- [ ] Search by keyword
- [ ] Browse by map location
- [ ] Filter by type
- [ ] View group details
- [ ] Request to join
- [ ] Leave group

### Chat

- [ ] View inbox
- [ ] Open group chat
- [ ] Send message
- [ ] View chat 3-dot menu options
- [ ] Access Members from chat
- [ ] Access Events from chat
- [ ] Access Attendance from chat (leaders)
- [ ] Leaders see Leaders Hub
- [ ] Members don't see Leaders Hub

### Profile

- [ ] View profile
- [ ] Edit profile
- [ ] Update photo

### Admin (Community Admins Only)

- [ ] View pending requests
- [ ] Approve/decline requests
- [ ] View user history
- [ ] Promote members to leaders
- [ ] Admin self-join and self-approve flow
- [ ] Pull-to-refresh after approval shows new chat
- [ ] Admin can edit groups without being a member (3-dot menu)
- [ ] Admin can view members without being in group (Members link on detail page)
- [ ] Admin can promote/demote members without being in group

### Group Editing (Community Admins Only)

- [ ] Edit form is prepopulated with existing data
- [ ] Edit basic info
- [ ] Edit location
- [ ] Edit meeting schedule
- [ ] Update group photos
- [ ] Non-admins cannot see edit button

---

## Common Issues to Watch For

| Issue                      | Symptom                    | Where to Check                              |
| -------------------------- | -------------------------- | ------------------------------------------- |
| Auth redirect loop         | Page keeps refreshing      | Console for auth errors                     |
| Failed to update group     | Error on save              | User permissions (must be community admin)  |
| Infinite member list       | Members keep loading       | Role filter server-side                     |
| Missing leaders chat       | Only general shows         | User's role in group (must be group leader) |
| Blank modal                | View History shows nothing | Network tab for API errors                  |
| Edit form empty            | Fields not prepopulated    | API response for group data                 |
| Profile photo not updating | Old photo still shows      | Cache clearing                              |
| Tab bar disappears         | No bottom navigation       | Modal presentation in \_layout.tsx          |
| Back button unresponsive   | Tapping back does nothing  | Touch target size (min 44x44)               |
| Navigation stack corrupted | Can't go back properly     | Route configuration in app layouts          |

---

## iOS-Specific Checks

### Touch Targets

All interactive elements must have minimum 44x44pt touch targets per iOS HIG:

- Back buttons
- Menu buttons
- Tab bar items
- List item tap areas
- Form inputs

### Tab Bar Visibility

The tab bar should remain visible when:

- On any main tab screen (Explore, Inbox, Admin, Profile)
- After dismissing a modal

The tab bar should be hidden when:

- In a detail screen (chat room, group detail, etc.)
- In a modal flow (events, members, attendance)

### Navigation Patterns

- Modal screens (`/(user)/...`, `/groups/...`) slide up from bottom
- Detail screens slide in from right
- Back gesture (swipe from left edge) should work on detail screens
- Pull-down dismissal should work on modal screens

### Safe Areas

Content should respect:

- Status bar / Dynamic Island at top
- Home indicator at bottom
- Tab bar when visible
