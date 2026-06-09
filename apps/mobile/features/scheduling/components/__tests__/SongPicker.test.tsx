import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SongPicker } from "../SongPicker";
import {
  useAuthenticatedMutation,
  useAuthenticatedQuery,
} from "@services/api/convex";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceSecondary: "#eee",
      border: "#ccc",
      buttonPrimary: "#2563EB",
      inputPlaceholder: "#aaa",
    },
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));

let mockIsAdmin = true;
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ user: { is_admin: mockIsAdmin } }),
}));

const mockNotify = jest.fn();
jest.mock("@/utils/platformAlert", () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        songs: {
          listSongs: "api.functions.scheduling.songs.listSongs",
          createSong: "api.functions.scheduling.songs.createSong",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(),
}));

const SONGS = [
  {
    _id: "song-1",
    communityId: "community-1",
    title: "Amazing Grace",
    author: "John Newton",
    defaultKey: "G",
    bpm: 72,
  },
  {
    _id: "song-2",
    communityId: "community-1",
    title: "How Great Thou Art",
    defaultKey: "C",
  },
];

describe("SongPicker", () => {
  let onSelect: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin = true;
    onSelect = jest.fn();
    (useAuthenticatedQuery as jest.Mock).mockImplementation(
      (fn: string, args: unknown) => {
        if (args === "skip") return undefined;
        if (fn === "api.functions.scheduling.songs.listSongs") return SONGS;
        return undefined;
      },
    );
    (useAuthenticatedMutation as jest.Mock).mockReturnValue(jest.fn());
  });

  it("shows the linked song's title when a song is selected", () => {
    const { getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId="song-1"
        song={SONGS[0] as any}
        onSelect={onSelect}
      />,
    );
    expect(getByText("Amazing Grace")).toBeTruthy();
  });

  it("lists and filters library songs when searching", async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );

    // Both songs available from the library query.
    expect(getByText("Amazing Grace")).toBeTruthy();
    expect(getByText("How Great Thou Art")).toBeTruthy();

    // Typing narrows the list to client-side matches.
    const search = getByPlaceholderText("Search songs…");
    fireEvent.changeText(search, "Amazing");
    await waitFor(() => {
      expect(getByText("Amazing Grace")).toBeTruthy();
      expect(queryByText("How Great Thou Art")).toBeNull();
    });
  });

  it("calls onSelect with the song id when a result is tapped", () => {
    const { getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.press(getByText("How Great Thou Art"));
    expect(onSelect).toHaveBeenCalledWith("song-2");
  });

  it("calls onSelect with null when Clear is pressed on a linked song", () => {
    const { getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId="song-1"
        song={SONGS[0] as any}
        onSelect={onSelect}
      />,
    );
    fireEvent.press(getByText("Clear"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("creates a new song then links it", async () => {
    const createSong = jest.fn().mockResolvedValue("song-new");
    (useAuthenticatedMutation as jest.Mock).mockReturnValue(createSong);

    const { getByPlaceholderText, getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );

    // Type a query that doesn't match, then create from it.
    fireEvent.changeText(getByPlaceholderText("Search songs…"), "Brand New Song");
    fireEvent.press(getByText('Create "Brand New Song"'));

    await waitFor(() => {
      expect(createSong).toHaveBeenCalledWith({
        communityId: "community-1",
        input: { title: "Brand New Song" },
      });
      expect(onSelect).toHaveBeenCalledWith("song-new");
    });
  });

  it("hides the inline Create action for non-admins (createSong is admin-only)", () => {
    mockIsAdmin = false;
    const { getByPlaceholderText, queryByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );

    // A non-admin can still search/link existing songs…
    fireEvent.changeText(getByPlaceholderText("Search songs…"), "Brand New Song");
    // …but the inline Create affordance (which would hit the admin-only
    // createSong guard) is not offered.
    expect(queryByText('Create "Brand New Song"')).toBeNull();
  });

  it("surfaces an error instead of failing silently when createSong rejects", async () => {
    const createSong = jest
      .fn()
      .mockRejectedValue(new Error("Only community admins can do that"));
    (useAuthenticatedMutation as jest.Mock).mockReturnValue(createSong);

    const { getByPlaceholderText, getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.changeText(getByPlaceholderText("Search songs…"), "Brand New Song");
    fireEvent.press(getByText('Create "Brand New Song"'));

    await waitFor(() => expect(mockNotify).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("navigates to the song library when Manage song library is pressed", () => {
    const { getByText } = render(
      <SongPicker
        communityId="community-1"
        groupId="group-1"
        songId={null}
        song={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.press(getByText("Manage song library"));
    expect(mockPush).toHaveBeenCalledWith("/rostering/group-1/songs");
  });
});
