import { NextResponse } from "next/server";
import { getStats } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getStats());
}
