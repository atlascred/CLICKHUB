import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ status: "success", message: "O disparo antigo foi desativado. Use WhatsApp Oficial.", data: { processed: 0, disabled: true } });
}
