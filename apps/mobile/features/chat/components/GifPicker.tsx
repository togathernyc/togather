/**
 * GifPicker - Full-screen bottom sheet GIF picker (WhatsApp-style)
 *
 * Opens as a Modal sliding up from the bottom. Shows trending GIFs by default,
 * search bar at top with Cancel button. Content filtered to PG-13 (no NSFW).
 * "Powered by KLIPY" attribution as required by their TOS.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  FlatList,
  Pressable,
  Text,
  Image,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@hooks/useTheme';

const KLIPY_API_KEY = process.env.EXPO_PUBLIC_KLIPY_API_KEY;
const KLIPY_BASE_URL = 'https://api.klipy.com/api/v1';
const SEARCH_DEBOUNCE_MS = 400;
const PER_PAGE = 24;
/** MPA-style content rating — allows G, PG, and PG-13 content */
const CONTENT_RATING = 'pg-13';

interface KlipyMediaFormat {
  url: string;
  width: number;
  height: number;
  size: number;
}

interface KlipyMediaSize {
  gif?: KlipyMediaFormat;
  webp?: KlipyMediaFormat;
  mp4?: KlipyMediaFormat;
  jpg?: KlipyMediaFormat;
}

interface KlipyGif {
  id: number;
  slug: string;
  title: string;
  file: {
    hd?: KlipyMediaSize;
    md?: KlipyMediaSize;
    sm?: KlipyMediaSize;
    xs?: KlipyMediaSize;
  };
}

interface GifPickerProps {
  visible: boolean;
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

const NUM_COLUMNS = 2;
const GRID_GAP = 4;

export function GifPicker({ visible, onSelect, onClose }: GifPickerProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const itemWidth = (screenWidth - GRID_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<KlipyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentQueryRef = useRef('');
  const searchInputRef = useRef<TextInput>(null);

  const fetchGifs = useCallback(async (searchQuery: string, pageNum: number) => {
    if (!KLIPY_API_KEY) {
      console.warn('[GifPicker] EXPO_PUBLIC_KLIPY_API_KEY not set');
      return { data: [], hasNext: false };
    }

    try {
      const endpoint = searchQuery.trim()
        ? `${KLIPY_BASE_URL}/${KLIPY_API_KEY}/gifs/search`
        : `${KLIPY_BASE_URL}/${KLIPY_API_KEY}/gifs/trending`;

      const params = new URLSearchParams({
        page: String(pageNum),
        per_page: String(PER_PAGE),
        rating: CONTENT_RATING,
      });

      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }

      const response = await fetch(`${endpoint}?${params}`);
      if (!response.ok) {
        console.error('[GifPicker] API error:', response.status);
        return { data: [], hasNext: false };
      }

      const json = await response.json();
      return {
        data: (json.data?.data ?? []) as KlipyGif[],
        hasNext: json.data?.has_next ?? false,
      };
    } catch (error) {
      console.error('[GifPicker] Fetch error:', error);
      return { data: [], hasNext: false };
    }
  }, []);

  // Load trending GIFs when modal opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setQuery('');
    setPage(1);
    currentQueryRef.current = '';
    fetchGifs('', 1).then(({ data, hasNext }) => {
      if (cancelled) return;
      setGifs(data);
      setHasMore(hasNext);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, fetchGifs]);

  // Debounced search
  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      currentQueryRef.current = text;
      setPage(1);
      setLoading(true);
      fetchGifs(text, 1).then(({ data, hasNext }) => {
        if (currentQueryRef.current !== text) return;
        setGifs(data);
        setHasMore(hasNext);
        setLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
  }, [fetchGifs]);

  // Pagination — capture query at call time to discard stale responses
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    const queryAtCallTime = currentQueryRef.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    fetchGifs(queryAtCallTime, nextPage).then(({ data, hasNext }) => {
      if (currentQueryRef.current !== queryAtCallTime) {
        setLoadingMore(false);
        return;
      }
      setGifs(prev => [...prev, ...data]);
      setPage(nextPage);
      setHasMore(hasNext);
      setLoadingMore(false);
    });
  }, [fetchGifs, page, hasMore, loadingMore]);

  const handleSelect = useCallback((gif: KlipyGif) => {
    const { hd, md, sm, xs } = gif.file ?? {};
    const url = hd?.gif?.url || md?.gif?.url || sm?.gif?.url || xs?.gif?.url
      || hd?.webp?.url || md?.webp?.url || sm?.webp?.url || xs?.webp?.url;
    if (url) {
      onSelect(url);
    }
  }, [onSelect]);

  const handleCancel = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setQuery('');
    currentQueryRef.current = '';
    onClose();
  }, [onClose]);

  const renderItem = useCallback(({ item }: { item: KlipyGif }) => {
    const sm = item.file?.sm;
    const xs = item.file?.xs;
    const previewUrl = sm?.webp?.url || sm?.gif?.url || xs?.webp?.url || xs?.gif?.url;
    if (!previewUrl) return null;

    return (
      <Pressable
        style={[styles.gifItem, { width: itemWidth, height: itemWidth }]}
        onPress={() => handleSelect(item)}
      >
        <Image
          source={{ uri: previewUrl }}
          style={styles.gifImage}
          resizeMode="cover"
        />
      </Pressable>
    );
  }, [handleSelect, itemWidth]);

  const backgroundColor = isDark ? '#1c1c1e' : '#fff';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={[styles.modalContainer, { backgroundColor }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Drag handle (iOS page sheet) */}
        {Platform.OS === 'ios' && (
          <View style={styles.dragHandleContainer}>
            <View style={[styles.dragHandle, { backgroundColor: isDark ? '#555' : '#ccc' }]} />
          </View>
        )}

        {/* Search header */}
        <View style={[styles.searchHeader, { paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8 }]}>
          <View style={[styles.searchBar, { backgroundColor: isDark ? '#2c2c2e' : '#f0f0f0' }]}>
            <Ionicons name="search" size={18} color={isDark ? '#999' : '#8e8e93'} />
            <TextInput
              ref={searchInputRef}
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search GIFs..."
              placeholderTextColor={isDark ? '#999' : '#8e8e93'}
              value={query}
              onChangeText={handleQueryChange}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => handleQueryChange('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={isDark ? '#999' : '#8e8e93'} />
              </Pressable>
            )}
          </View>
          <Pressable onPress={handleCancel} style={styles.cancelButton} hitSlop={8}>
            <Text style={[styles.cancelText, { color: colors.link }]}>Cancel</Text>
          </Pressable>
        </View>

        {/* Grid */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.link} />
          </View>
        ) : gifs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="images-outline" size={48} color={isDark ? '#555' : '#ccc'} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {query ? 'No GIFs found' : 'No trending GIFs'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={gifs}
            renderItem={renderItem}
            keyExtractor={(item) => String(item.id)}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + 24 }]}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              <>
                {loadingMore && (
                  <ActivityIndicator size="small" color={colors.link} style={styles.loadingMore} />
                )}
                <Text style={[styles.attributionText, { color: isDark ? '#666' : '#aaa' }]}>
                  Powered by KLIPY
                </Text>
              </>
            }
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
      default: {},
    }),
  },
  cancelButton: {
    paddingVertical: 6,
  },
  cancelText: {
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
  },
  gridContent: {
    paddingHorizontal: GRID_GAP / 2,
    paddingTop: 4,
  },
  gridRow: {
    gap: GRID_GAP,
    paddingHorizontal: GRID_GAP / 2,
    marginBottom: GRID_GAP,
  },
  gifItem: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  gifImage: {
    width: '100%',
    height: '100%',
  },
  loadingMore: {
    paddingVertical: 12,
  },
  attributionText: {
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
