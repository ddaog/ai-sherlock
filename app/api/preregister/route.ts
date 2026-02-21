/**
 * 사전등록 API - Google Apps Script로 JSON 전송
 *
 * Google Apps Script는 아래 doPost로 JSON 수신 필요:
 *
 * function doPost(e) {
 *   var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
 *   var data = JSON.parse(e.postData.getDataAsString());
 *   sheet.appendRow([new Date(), data.email, data.name, data.url || ""]);
 *   return ContentService.createTextOutput(JSON.stringify({ result: "success" }))
 *     .setMimeType(ContentService.MimeType.JSON);
 * }
 */
import { NextRequest, NextResponse } from "next/server";

const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbx5tt-8QsWtaAOk_wbPiq9ILbSlJsTVMqn0M_pMRiTih0609GCzk64kQaYnwVSEBGGATw/exec";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, name, url: clientUrl } = body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ success: false, error: "이메일을 입력해 주세요." }, { status: 400 });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ success: false, error: "이름을 입력해 주세요." }, { status: 400 });
    }

    const url = typeof clientUrl === "string" ? clientUrl : req.headers.get("referer") ?? "";

    const payload = {
      email: email.trim(),
      name: name.trim(),
      url,
    };

    const res = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await res.text();
    let data: { result?: string; error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { result: text };
    }

    if (data.result === "success") {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { success: false, error: data.error || "등록에 실패했습니다." },
      { status: 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
