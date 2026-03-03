// Explore feature constants
import {
  GROUP_TYPE_COLORS as SHARED_GROUP_TYPE_COLORS,
  DEFAULT_GROUP_COLOR as SHARED_DEFAULT_GROUP_COLOR,
  getGroupTypeColor,
} from '../../constants/groupTypes';
import { DEFAULT_PRIMARY_COLOR, colors } from '../../utils/styles';

export const MAP_CONFIG = {
  // Default center (Dallas, TX as a reasonable US default)
  defaultCenter: {
    lat: 32.7767,
    lng: -96.7970,
  },
  defaultZoom: 12,
  minZoom: 3,
  maxZoom: 18,
  // 3D view pitch in degrees
  pitch: 60,
  bearing: 0,
};

export const MAP_STYLE = 'mapbox://styles/mapbox/standard';

export const COLORS = {
  primary: DEFAULT_PRIMARY_COLOR,
  primaryLight: colors.accentLight,
  markerDefault: DEFAULT_PRIMARY_COLOR,
  markerSelected: '#FF6B6B',
  clusterBackground: DEFAULT_PRIMARY_COLOR,
  clusterText: '#FFFFFF',
  text: '#333',
  textMuted: '#666',
  border: '#E5E5E5',
  background: '#fff',
};

// Group type colors matching the inbox badge colors
// Re-export from shared constants for backwards compatibility
export const GROUP_TYPE_COLORS = SHARED_GROUP_TYPE_COLORS;

// Default color for unknown group types
export const DEFAULT_GROUP_COLOR = SHARED_DEFAULT_GROUP_COLOR;

// Export the dynamic color function for use with any group type ID
export { getGroupTypeColor };

export const SNAP_POINTS = {
  collapsed: '15%',
  half: '50%',
  full: '95%',
} as const;

export const SNAP_POINT_VALUES = ['15%', '50%', '95%'] as const;

// Cluster configuration
export const CLUSTER_CONFIG = {
  radius: 50, // Cluster radius in pixels
  maxZoom: 14, // Max zoom to cluster points
  minPoints: 2, // Min points to form a cluster
};

// Filter options
export const DISTANCE_OPTIONS = [
  { label: 'Any distance', value: null },
  { label: '5 miles', value: 5 },
  { label: '10 miles', value: 10 },
  { label: '25 miles', value: 25 },
  { label: '50 miles', value: 50 },
];

export const DAY_OPTIONS = [
  { label: 'Any day', value: null },
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
];

export const MEETING_TYPE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'In-Person', value: 'in-person' },
  { label: 'Online', value: 'online' },
] as const;

export const GROUP_STATUS_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
] as const;
