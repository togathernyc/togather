/**
 * PollCardFromMessage — wrapper that fetches a poll by id and wires
 * vote / edit / close / delete mutations to PollCard.
 *
 * Mounted from MessageItem when contentType === "poll". The underlying
 * `getPoll` query is reactive, so vote counts update for every viewer
 * the moment any voter casts a vote.
 */
import React, { useCallback, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import type { Id } from '@services/api/convex';
import { api, useQuery, useStoredAuthToken, useAuthenticatedMutation } from '@services/api/convex';
import { useTheme } from '@hooks/useTheme';
import { PollCard } from './PollCard';
import { PollCreatorSheet } from './PollCreatorSheet';

interface Props {
  pollId: Id<'polls'>;
}

export function PollCardFromMessage({ pollId }: Props) {
  const { colors } = useTheme();
  const token = useStoredAuthToken();
  const [editing, setEditing] = useState(false);

  const poll = useQuery(
    api.functions.messaging.polls.getPoll,
    token ? { token, pollId } : 'skip',
  );

  const voteOnPoll = useAuthenticatedMutation(api.functions.messaging.polls.voteOnPoll);
  const closePoll = useAuthenticatedMutation(api.functions.messaging.polls.closePoll);
  const deletePoll = useAuthenticatedMutation(api.functions.messaging.polls.deletePoll);

  const handleCastVote = useCallback(
    async (optionIds: string[]) => {
      await voteOnPoll({ pollId, optionIds });
    },
    [pollId, voteOnPoll],
  );

  const handleClose = useCallback(async () => {
    try {
      await closePoll({ pollId });
    } catch {
      // Surface via PollCard? closePoll is invoked from a confirm dialog so
      // a silent failure is acceptable here — the poll just stays open.
    }
  }, [pollId, closePoll]);

  const handleDelete = useCallback(async () => {
    try {
      await deletePoll({ pollId });
    } catch {
      // Same reasoning as close — the message simply stays put.
    }
  }, [pollId, deletePoll]);

  if (poll === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.link} />
      </View>
    );
  }
  if (poll === null) {
    return null;
  }

  return (
    <>
      <PollCard
        question={poll.question}
        options={poll.options}
        allowMultiple={poll.allowMultiple}
        status={poll.status}
        voteCount={poll.voteCount}
        voterCount={poll.voterCount}
        myVoteOptionIds={poll.myVoteOptionIds}
        editCount={poll.editCount}
        permissions={poll.permissions}
        onCastVote={handleCastVote}
        onEdit={() => setEditing(true)}
        onClose={handleClose}
        onDelete={handleDelete}
      />
      {editing && (
        <PollCreatorSheet
          mode="edit"
          visible={editing}
          pollId={pollId}
          initialQuestion={poll.question}
          initialOptions={poll.options.map((o) => ({ id: o.id, text: o.text }))}
          initialAllowMultiple={poll.allowMultiple}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 16,
    alignItems: 'center',
  },
});
