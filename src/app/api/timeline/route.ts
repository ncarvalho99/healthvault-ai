import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/session";
import { TimelineService } from "@/lib/services/timeline-service";

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

  const events = await TimelineService.getTimeline(user!.userId, limit);
  return NextResponse.json({ events });
}

export async function DELETE(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const eventId = url.searchParams.get("eventId");
  const userId = user!.userId;

  try {
    if (action === "clearAll") {
      await TimelineService.clearAll(userId);
      return NextResponse.json({ success: true, message: "Linha do tempo limpa com sucesso" });
    }

    if (eventId) {
      await TimelineService.deleteEvent(userId, eventId);
      return NextResponse.json({ success: true, message: "Evento removido da linha do tempo" });
    }

    return NextResponse.json({ error: "Missing action or eventId parameter" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to delete timeline event" }, { status: 500 });
  }
}
