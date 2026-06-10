import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SongLibraryScreen } from "../SongLibraryScreen";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
} from "@services/api/convex";
import { useFileUpload } from "@features/chat/hooks/useFileUpload";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ canGoBack: () => true, back: mockBack }),
  useLocalSearchParams: () => ({ group_id: "group-1" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

// Whether the current user may manage songs (admin or group leader), surfaced
// by the canManageSongs query.
let mockCanManage = true;
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ community: { id: "community-1" } }),
}));

jest.mock("@features/chat/hooks/useFileUpload", () => ({
  useFileUpload: jest.fn(),
}));

jest.mock(
  "expo-document-picker",
  () => ({
    getDocumentAsync: jest.fn().mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file://chart.pdf",
          name: "chart.pdf",
          size: 1000,
          mimeType: "application/pdf",
        },
      ],
    }),
  }),
  { virtual: true },
);

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        songs: {
          listSongs: "api.functions.scheduling.songs.listSongs",
          createSong: "api.functions.scheduling.songs.createSong",
          updateSong: "api.functions.scheduling.songs.updateSong",
          deleteSong: "api.functions.scheduling.songs.deleteSong",
          attachChart: "api.functions.scheduling.songs.attachChart",
          removeChart: "api.functions.scheduling.songs.removeChart",
          canManageSongs: "api.functions.scheduling.songs.canManageSongs",
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
    charts: [
      { label: "Lead sheet (G)", key: "G", fileKey: "r2:abc", mimeType: "application/pdf" },
    ],
  },
  {
    _id: "song-2",
    communityId: "community-1",
    title: "How Great Thou Art",
    defaultKey: "C",
  },
];

function setMutations(map: Record<string, jest.Mock>) {
  (useAuthenticatedMutation as jest.Mock).mockImplementation((fn: string) => {
    return map[fn] ?? jest.fn();
  });
}

describe("SongLibraryScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanManage = true;
    (useAuthenticatedQuery as jest.Mock).mockImplementation(
      (fn: string, args: unknown) => {
        if (args === "skip") return undefined;
        if (fn === "api.functions.scheduling.songs.listSongs") return SONGS;
        if (fn === "api.functions.scheduling.songs.canManageSongs")
          return mockCanManage;
        return undefined;
      },
    );
    setMutations({});
    (useFileUpload as jest.Mock).mockReturnValue({
      uploadFile: jest.fn(),
      uploading: false,
      progress: 0,
      reset: jest.fn(),
      isAvailable: true,
    });
  });

  it("renders the community song list", () => {
    const { getByText } = render(<SongLibraryScreen />);
    expect(getByText("Amazing Grace")).toBeTruthy();
    expect(getByText("How Great Thou Art")).toBeTruthy();
  });

  it("passes the search term to the query", () => {
    const { getByPlaceholderText } = render(<SongLibraryScreen />);
    fireEvent.changeText(getByPlaceholderText("Search songs…"), "grace");
    const calls = (useAuthenticatedQuery as jest.Mock).mock.calls.filter(
      (c) => c[0] === "api.functions.scheduling.songs.listSongs",
    );
    const last = calls[calls.length - 1];
    expect(last[1]).toMatchObject({ communityId: "community-1", search: "grace" });
  });

  it("creates a song with the entered fields", async () => {
    const createSong = jest.fn().mockResolvedValue("song-new");
    setMutations({ "api.functions.scheduling.songs.createSong": createSong });

    const { getByText, getByLabelText } = render(<SongLibraryScreen />);
    fireEvent.press(getByText("Add song"));
    fireEvent.changeText(getByLabelText("Title"), "New Song");
    fireEvent.changeText(getByLabelText("Default key"), "D");
    fireEvent.press(getByText("Save"));

    await waitFor(() => {
      expect(createSong).toHaveBeenCalledWith({
        communityId: "community-1",
        input: expect.objectContaining({ title: "New Song", defaultKey: "D" }),
      });
    });
  });

  it("updates a song when editing", async () => {
    const updateSong = jest.fn().mockResolvedValue(undefined);
    setMutations({ "api.functions.scheduling.songs.updateSong": updateSong });

    const { getByText, getByLabelText, getAllByText } = render(<SongLibraryScreen />);
    fireEvent.press(getAllByText("Edit")[0]);
    fireEvent.changeText(getByLabelText("Author"), "J. Newton");
    fireEvent.press(getByText("Save"));

    await waitFor(() => {
      expect(updateSong).toHaveBeenCalledWith({
        songId: "song-1",
        patch: expect.objectContaining({ author: "J. Newton" }),
      });
    });
  });

  it("deletes a song with confirmation", async () => {
    const deleteSong = jest.fn().mockResolvedValue(undefined);
    setMutations({ "api.functions.scheduling.songs.deleteSong": deleteSong });
    // On native, the confirm uses Alert.alert; press its destructive button.
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const destructive = (buttons ?? []).find((b) => b.style === "destructive");
        destructive?.onPress?.();
      });

    const { getByText, getAllByText } = render(<SongLibraryScreen />);
    fireEvent.press(getAllByText("Edit")[0]);
    fireEvent.press(getByText("Delete song"));

    await waitFor(() => {
      expect(deleteSong).toHaveBeenCalledWith({ songId: "song-1" });
    });
    alertSpy.mockRestore();
  });

  it("uploads a chart and attaches it", async () => {
    const attachChart = jest.fn().mockResolvedValue(undefined);
    setMutations({ "api.functions.scheduling.songs.attachChart": attachChart });
    const uploadFile = jest.fn().mockResolvedValue({
      storagePath: "r2:newchart",
      name: "chart.pdf",
      category: "document",
    });
    (useFileUpload as jest.Mock).mockReturnValue({
      uploadFile,
      uploading: false,
      progress: 0,
      reset: jest.fn(),
      isAvailable: true,
    });

    const { getByText, getAllByText } = render(<SongLibraryScreen />);
    fireEvent.press(getAllByText("Edit")[0]);
    fireEvent.press(getByText("Upload chart"));

    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalled();
      expect(attachChart).toHaveBeenCalledWith({
        songId: "song-1",
        chart: expect.objectContaining({
          fileKey: "r2:newchart",
          mimeType: "application/pdf",
        }),
      });
    });
  });

  it("removes a chart", async () => {
    const removeChart = jest.fn().mockResolvedValue(undefined);
    setMutations({ "api.functions.scheduling.songs.removeChart": removeChart });

    const { getByText, getByLabelText, getAllByText } = render(<SongLibraryScreen />);
    fireEvent.press(getAllByText("Edit")[0]);
    fireEvent.press(getByLabelText("Remove chart Lead sheet (G)"));

    await waitFor(() => {
      expect(removeChart).toHaveBeenCalledWith({
        songId: "song-1",
        fileKey: "r2:abc",
      });
    });
  });

  it("hides editing controls for members who can't manage songs", () => {
    mockCanManage = false;
    const { queryByText } = render(<SongLibraryScreen />);
    expect(queryByText("Add song")).toBeNull();
    expect(queryByText("Edit")).toBeNull();
  });
});
