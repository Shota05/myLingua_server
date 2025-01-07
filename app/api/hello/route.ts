import { NextResponse } from "next/server";

// GETリクエスト用
export async function GET() {
  return NextResponse.json({ message: "Hello from GET!" });
}
