import { NextResponse } from "next/server";
import { failStoredRun, finishStoredRun, listStoredRuns, startStoredRun } from "@/db";
import { answerCase } from "@/lib/candidate/answer";
import type { CaseInput } from "@/lib/challenge/types";

export async function POST(request: Request) {
  const startedAt = Date.now();
  const runId = await startStoredRun();

  try {
    const input = (await request.json()) as CaseInput;
    const output = await answerCase(input);
    await finishStoredRun(runId, {
      durationMs: Date.now() - startedAt,
      estimatedCostUsd: output.estimatedCostUsd,
      output,
    });
    return NextResponse.json(output);
  } catch (error) {
    await failStoredRun(runId, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Answer engine failed" },
      { status: 501 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ runs: await listStoredRuns() });
}
