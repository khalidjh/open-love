import { NextRequest, NextResponse } from 'next/server';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';
import type { ConversationState } from '@/types/conversation';

function freshConversation(): ConversationState {
  return {
    conversationId: `conv-${Date.now()}`,
    startedAt: Date.now(),
    lastUpdated: Date.now(),
    context: {
      messages: [],
      edits: [],
      projectEvolution: { majorChanges: [] },
      userPreferences: {},
    },
  };
}

// GET: Retrieve the caller's project conversation state.
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
  if (!projectId) {
    return NextResponse.json({ success: true, state: null, message: 'No active conversation' });
  }
  try {
    const { session } = await requireProjectSession(projectId);
    return NextResponse.json({
      success: true,
      state: session.conversationState ?? null,
      message: session.conversationState ? undefined : 'No active conversation',
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

// POST: Reset or update the caller's project conversation state.
export async function POST(request: NextRequest) {
  try {
    const { action, data, projectId } = await request.json();

    // Best-effort mount-time cleanup can run before a project exists — no-op.
    if (!projectId) {
      return NextResponse.json({ success: true, message: 'No project yet; nothing to do', state: null });
    }

    const { session } = await requireProjectSession(projectId);

    switch (action) {
      case 'reset':
        session.conversationState = freshConversation();
        console.log('[conversation-state] Reset conversation state');
        return NextResponse.json({ success: true, message: 'Conversation state reset', state: session.conversationState });

      case 'clear-old':
        if (!session.conversationState) {
          session.conversationState = freshConversation();
          return NextResponse.json({ success: true, message: 'New conversation state initialized', state: session.conversationState });
        }
        session.conversationState.context.messages = session.conversationState.context.messages.slice(-5);
        session.conversationState.context.edits = session.conversationState.context.edits.slice(-3);
        session.conversationState.context.projectEvolution.majorChanges =
          session.conversationState.context.projectEvolution.majorChanges.slice(-2);
        console.log('[conversation-state] Cleared old conversation data');
        return NextResponse.json({ success: true, message: 'Old conversation data cleared', state: session.conversationState });

      case 'update':
        if (!session.conversationState) {
          return NextResponse.json({ success: false, error: 'No active conversation to update' }, { status: 400 });
        }
        if (data) {
          if (data.currentTopic) {
            session.conversationState.context.currentTopic = data.currentTopic;
          }
          if (data.userPreferences) {
            session.conversationState.context.userPreferences = {
              ...session.conversationState.context.userPreferences,
              ...data.userPreferences,
            };
          }
          session.conversationState.lastUpdated = Date.now();
        }
        return NextResponse.json({ success: true, message: 'Conversation state updated', state: session.conversationState });

      default:
        return NextResponse.json({ success: false, error: 'Invalid action. Use "reset" or "update"' }, { status: 400 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}

// DELETE: Clear the caller's project conversation state.
export async function DELETE(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;
  if (!projectId) {
    return NextResponse.json({ success: true, message: 'No project yet; nothing to do' });
  }
  try {
    const { session } = await requireProjectSession(projectId);
    session.conversationState = null;
    console.log('[conversation-state] Cleared conversation state');
    return NextResponse.json({ success: true, message: 'Conversation state cleared' });
  } catch (error) {
    return toErrorResponse(error);
  }
}
