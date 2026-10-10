import { MessagesView } from '@/components/messages/MessagesView';

/**
 * The member's inbox is now Messages (Oct 2026, Victor's decisions of 9 Oct):
 * conversations between companies, the first messages waiting for an answer, and
 * what the member's company sent (src/components/messages/MessagesView.tsx). The
 * name stays so the dashboard's Messages tile and /inbox keep importing it.
 *
 * What moved out: team invitations sent and people asking to join the company are
 * in "My team" (join requests also in the dashboard's to-do); recommendation
 * requests are in "References".
 */
export function InboxTab() {
  return <MessagesView />;
}
