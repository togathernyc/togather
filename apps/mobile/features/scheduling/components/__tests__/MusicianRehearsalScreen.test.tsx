import React from "react";
import { Linking } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { MusicianRehearsalScreen } from "../MusicianRehearsalScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useLocalSearchParams: () => ({ plan_id: "plan-1", group_id: "group-1" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      border: "#e5e5e5",
    },
    isDark: false,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        events: { getEvent: "api.functions.scheduling.events.getEvent" },
        eventItems: {
          listItems: "api.functions.scheduling.eventItems.listItems",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

const mockQuery = useAuthenticatedQuery as jest.Mock;

const EVENT = {
  _id: "plan-1",
  title: "Sunday Gathering",
  eventDate: new Date("2026-06-14T10:00:00").getTime(),
};

/** Wire getEvent + listItems based on the query reference passed. */
function mockQueries(items: unknown) {
  mockQuery.mockImplementation((ref: string) => {
    if (ref === "api.functions.scheduling.events.getEvent") return EVENT;
    if (ref === "api.functions.scheduling.eventItems.listItems") return items;
    return undefined;
  });
}

describe("MusicianRehearsalScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  });

  it("renders each song with its effective key and BPM", () => {
    mockQueries([
      {
        _id: "item-1",
        type: "song",
        title: "Free-typed title",
        // Override key present; BPM falls back to the library song default.
        songDetails: { key: "A" },
        song: {
          _id: "song-1",
          title: "Build My Life",
          defaultKey: "G",
          bpm: 68,
          meter: "4/4",
          arrangementName: "Acoustic",
          structure: ["Intro", "Verse 1", "Chorus"],
          charts: [],
        },
      },
    ]);

    const { getByText, queryByText } = render(<MusicianRehearsalScreen />);

    // Library title wins over the free-typed item title.
    expect(getByText("Build My Life")).toBeTruthy();
    expect(queryByText("Free-typed title")).toBeNull();
    // Effective key = override "A"; effective BPM = song default 68; meter 4/4.
    expect(getByText("Key A  ·  68 BPM  ·  4/4")).toBeTruthy();
    expect(getByText("Acoustic")).toBeTruthy();
    expect(getByText("Intro")).toBeTruthy();
    expect(getByText("Chorus")).toBeTruthy();
  });

  it("opens a chart file when its button is pressed", () => {
    mockQueries([
      {
        _id: "item-1",
        type: "song",
        title: "Song",
        song: {
          _id: "song-1",
          title: "Build My Life",
          charts: [
            {
              key: "G",
              label: "Chord Chart",
              fileKey: "r2:charts/abc.pdf",
              mimeType: "application/pdf",
              url: "https://cdn.example.com/abc.pdf",
            },
          ],
        },
      },
    ]);

    const { getByText } = render(<MusicianRehearsalScreen />);
    fireEvent.press(getByText("Chord Chart (G)"));
    expect(Linking.openURL).toHaveBeenCalledWith("https://cdn.example.com/abc.pdf");
  });

  it("opens the multitracks provider link externally", () => {
    mockQueries([
      {
        _id: "item-1",
        type: "song",
        title: "Song",
        song: {
          _id: "song-1",
          title: "Build My Life",
          multitracksUrl: "https://www.multitracks.com/songs/build-my-life",
        },
      },
    ]);

    const { getByText } = render(<MusicianRehearsalScreen />);
    fireEvent.press(getByText("Rehearse multitracks"));
    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://www.multitracks.com/songs/build-my-life",
    );
  });

  it("renders a free-typed song row that has no linked library song", () => {
    mockQueries([
      {
        _id: "item-1",
        type: "song",
        title: "Spontaneous Worship",
        songDetails: { key: "D" },
        song: null,
      },
    ]);

    const { getByText } = render(<MusicianRehearsalScreen />);
    expect(getByText("Spontaneous Worship")).toBeTruthy();
    expect(getByText("Key D")).toBeTruthy();
  });

  it("only lists song-type items, ignoring headers and generic items", () => {
    mockQueries([
      { _id: "h", type: "header", title: "Welcome" },
      { _id: "i", type: "item", title: "Announcements" },
      {
        _id: "s",
        type: "song",
        title: "Opener",
        song: { _id: "song-1", title: "Opener" },
      },
    ]);

    const { getByText, queryByText } = render(<MusicianRehearsalScreen />);
    expect(getByText("Opener")).toBeTruthy();
    expect(queryByText("Welcome")).toBeNull();
    expect(queryByText("Announcements")).toBeNull();
  });

  it("shows an empty state when there are no songs", () => {
    mockQueries([{ _id: "h", type: "header", title: "Welcome" }]);
    const { getByText } = render(<MusicianRehearsalScreen />);
    expect(getByText(/No songs on this run sheet/i)).toBeTruthy();
  });
});
