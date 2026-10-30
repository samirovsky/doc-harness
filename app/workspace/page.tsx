"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import expectedOutput from "@/data/playbook/expected-output.json";
import playbook from "@/data/playbook/questions.json";
import { evidenceFiles, type EvidenceFileKind } from "@/lib/challenge/source-files";
import type { AnswerValue, CaseOutput } from "@/lib/challenge/types";

type RunState = "idle" | "running" | "complete" | "error";
type RunResult = { output: CaseOutput; durationMs: number };
type ComparisonRow = {
  questionId: string;
  submitted?: AnswerValue;
  expected: AnswerValue;
  valueMatches: boolean;
  sourceMatches: boolean;
  correct: boolean;
};

const expectedAnswers = expectedOutput.answers as Record<string, AnswerValue>;

function isCaseOutput(value: unknown): value is CaseOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CaseOutput>;
  return typeof candidate.caseId === "string" && typeof candidate.estimatedCostUsd === "number" && !!candidate.answers && typeof candidate.answers === "object" && !Array.isArray(candidate.answers);
}

function compareOutput(output: CaseOutput): ComparisonRow[] {
  return playbook.questions.map(({ questionId }) => {
    const submitted = output.answers[questionId];
    const expected = expectedAnswers[questionId];
    const valueMatches = submitted !== undefined && Object.is(submitted.value, expected.value);
    const sourceMatches = submitted !== undefined && (
      expected.value === null ||
      submitted.evidenceFileIds.some((fileId) => expected.evidenceFileIds.includes(fileId))
    );

    return {
      questionId,
      submitted,
      expected,
      valueMatches,
      sourceMatches,
      correct: valueMatches && sourceMatches,
    };
  });
}

function displayValue(value: AnswerValue["value"] | undefined) {
  if (value === undefined) return "missing";
  return JSON.stringify(value);
}

function createDemoOutput(): CaseOutput {
  const answers = Object.fromEntries(
    Object.entries(expectedAnswers).map(([questionId, answer], index) => {
      if (index % 11 === 0) {
        const wrongValue = typeof answer.value === "number"
          ? answer.value + 1
          : typeof answer.value === "boolean"
            ? !answer.value
            : `${answer.value} demo`;
        return [questionId, { ...answer, value: wrongValue }];
      }
      if (index % 13 === 0) {
        return [questionId, { ...answer, evidenceFileIds: ["unverified-demo-source.pdf"] }];
      }
      return [questionId, answer];
    }),
  );

  return { caseId: expectedOutput.caseId, estimatedCostUsd: 0.1847, answers };
}
const fileColors: Record<EvidenceFileKind, string> = {
  CSV: "border-[#79bdac]/35 bg-[#79bdac]/10 text-[#9bd5c7]",
  PDF: "border-[#ef6659]/35 bg-[#ef6659]/10 text-[#ff8d80]",
  DOCX: "border-[#4f8fce]/35 bg-[#4f8fce]/10 text-[#84b9e8]",
  PPTX: "border-[#dc9853]/35 bg-[#dc9853]/10 text-[#eeb979]",
  PNG: "border-[#9a8bd6]/35 bg-[#9a8bd6]/10 text-[#b9aaed]",
  XLSX: "border-[#5f9fd2]/35 bg-[#5f9fd2]/10 text-[#8fc2e8]",
};

export default function Workspace() {
  const [runState, setRunState] = useState<RunState>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const comparison = result ? compareOutput(result.output) : [];
  const correctCount = comparison.filter(({ correct }) => correct).length;

  async function startRun() {
    setRunState("running");
    setResult(null);
    setError("");
    const startedAt = window.performance.now();

    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setResult({ output: createDemoOutput(), durationMs: Math.round(window.performance.now() - startedAt) });
        setRunState("complete");
        return;
      }

      const response = await fetch("/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(playbook),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Candidate run failed";
        throw new Error(message);
      }
      if (!isCaseOutput(payload)) throw new Error("Returned payload does not match the required CaseOutput contract");
      setResult({ output: payload, durationMs: Math.round(window.performance.now() - startedAt) });
      setRunState("complete");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Candidate run failed");
      setRunState("error");
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#071117] text-[#f4f1e9]">
      <div className="pointer-events-none fixed inset-0 bg-[url('/hero-andor.jpg')] bg-cover bg-center opacity-[.13]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_80%_8%,rgba(217,154,80,.13),transparent_25%),linear-gradient(90deg,rgba(7,17,23,.98),rgba(7,17,23,.84)_58%,rgba(7,17,23,.94))]" />
      <div className="pointer-events-none fixed inset-0 opacity-[.10] [background-image:linear-gradient(rgba(142,196,201,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(142,196,201,.18)_1px,transparent_1px)] [background-size:44px_44px]" />

      <header className="relative z-20 border-b border-white/10 bg-[#071117]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-8 rotate-45 place-items-center border border-[#d99a50] font-mono text-xs font-bold text-[#d99a50]"><i className="-rotate-45 not-italic">A</i></span>
            <span><b className="block text-[11px] tracking-[.2em]">ANDOR CASE LAB</b><span className="mt-1 block font-mono text-[9px] tracking-[.12em] text-[#74858b]">CANDIDATE WORKSPACE</span></span>
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/" className="hidden font-mono text-[10px] tracking-[.12em] text-[#91a0a5] transition-colors hover:text-white sm:block">← BRIEF</Link>
            <span className="flex items-center gap-2 font-mono text-[10px] tracking-[.1em] text-[#9bd5c7]"><i className="size-1.5 rounded-full bg-[#62d2a4] shadow-[0_0_12px_#62d2a4]" /> PACKAGE READY</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-[1240px] px-5 pb-16 pt-12">
        <section className="grid gap-10 border-b border-white/10 pb-11 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-5 flex items-center gap-3 font-mono text-[10px] tracking-[.16em] text-[#ee5b4b]"><span>CASE // 001</span><span className="h-px w-10 bg-[#ee5b4b]/60" /><span>PRACTICE DOSSIER</span></div>
            <h1 className="text-5xl font-black leading-[.92] tracking-[-.055em] sm:text-7xl">Decode the record.<br /><span className="text-[#d99a50]">Return the truth.</span></h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#9eaaae]">Build a retrieval and reasoning workflow over the prepared evidence. Return one canonical answer and its origin file set for every question.</p>
          </div>
          <div className="grid grid-cols-2 border border-white/10 bg-[#0b1820]/80 sm:grid-cols-4 lg:grid-cols-2">
            <HeaderMetric value="30" label="SOURCE FILES" />
            <HeaderMetric value="50" label="QUESTIONS" />
            <HeaderMetric value="3–4h" label="TIME BOX" />
            <HeaderMetric value="$20" label="PREP CREDIT" accent />
          </div>
        </section>

        <section className="grid border-b border-white/10 sm:grid-cols-3">
          <Step index="01" title="Evidence" detail="30 raw files ready" complete />
          <Step index="02" title="Playbook" detail="50 questions loaded" complete />
          <Step index="03" title="Answer engine" detail="Implement + evaluate" />
        </section>

        <section className="grid gap-5 py-7 lg:grid-cols-[1.35fr_.65fr]">
          <div className="overflow-hidden border border-white/10 bg-[#0b1820]/90 shadow-2xl shadow-black/20 backdrop-blur-sm">
            <div className="flex flex-col justify-between gap-4 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-end">
              <div><SectionKicker>RAW EVIDENCE</SectionKicker><h2 className="mt-2 text-xl font-semibold tracking-tight">Case package</h2><p className="mt-1 text-xs text-[#7e8f95]">data/case/files/ · read-only</p></div>
              <div className="flex flex-wrap gap-1.5">
                {([['PDF', 9], ['XLSX', 6], ['CSV', 6], ['PPTX', 4], ['DOCX', 2], ['PNG', 3]] as const).map(([type, count]) => <span key={type} className={`border px-2 py-1 font-mono text-[9px] ${fileColors[type]}`}>{type} <b>{count}</b></span>)}
              </div>
            </div>
            <div className="grid sm:grid-cols-2">
              {evidenceFiles.map((file, index) => (
                <a
                  key={file.name}
                  href={`/case-files/${file.name}`}
                  target="_blank"
                  rel="noreferrer"
                  download={["CSV", "DOCX", "PPTX", "XLSX"].includes(file.type) ? file.name : undefined}
                  title={`Open ${file.name}`}
                  className={`group flex min-w-0 items-center gap-3 border-white/[.07] px-4 py-3 transition-colors hover:bg-white/[.055] focus-visible:bg-white/[.055] focus-visible:outline-none ${index % 2 === 0 ? "sm:border-r" : ""} ${index < evidenceFiles.length - 2 ? "border-b" : index === evidenceFiles.length - 2 ? "border-b sm:border-b-0" : ""}`}
                >
                  <span className={`grid size-9 shrink-0 place-items-center border font-mono text-[9px] font-bold ${fileColors[file.type]}`}>{file.type.slice(0, 2)}</span>
                  <div className="min-w-0 flex-1"><p className="break-all font-mono text-[11px] leading-4 text-[#d8dedc] group-hover:text-white">{file.name}</p><p className="mt-1 font-mono text-[8px] tracking-[.1em] text-[#5f7178]">SOURCE {String(index + 1).padStart(2, "0")} · READY</p></div>
                  <span aria-hidden="true" className="shrink-0 font-mono text-[9px] text-[#66787f] transition-colors group-hover:text-[#d99a50]">OPEN ↗</span>
                </a>
              ))}
            </div>
            <div className="flex gap-3 border-t border-[#86bfc5]/15 bg-[#86bfc5]/[.055] px-5 py-4 text-xs leading-5 text-[#9ec6c9]"><span className="mt-0.5 text-[#d99a50]">◆</span><p>The original documents are provided as-is. Build your own parsing and retrieval workflow, then cite the file ID or file IDs that support each answer.</p></div>
          </div>

          <aside className="space-y-5">
            <div className="border border-white/10 bg-[#0b1820]/90 p-5 backdrop-blur-sm">
              <SectionKicker>INTEGRATION</SectionKicker>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">Your pipeline. Strict output.</h2>
              <p className="mt-2 text-sm leading-6 text-[#87969b]">The runner posts to <code>app/api/answer/route.ts</code>. That test entrypoint invokes <code>answerCase()</code>, which should call the functions that make up your solution.</p>
              <div className="mt-5 border-l-2 border-[#d99a50] bg-[#061016] px-4 py-3">
                <p className="font-mono text-[9px] tracking-[.12em] text-[#697b82]">YOUR COORDINATOR</p>
                <code className="mt-1.5 block break-all font-mono text-xs text-[#9bd5d8]">lib/candidate/answer.ts</code>
              </div>
              <pre className="mt-3 overflow-x-auto bg-[#061016] p-4 font-mono text-[10px] leading-5 text-[#cdd5d5]"><code>{`export async function answerCase(
  input: CaseInput
): Promise<CaseOutput>`}</code></pre>
              <div className="mt-5 space-y-3">
                <Check>Use any harness, libraries or frameworks you prefer.</Check>
                <Check>We only need something that works and that you can explain.</Check>
                <Check>Do not change the supplied GLM 5.3 Flash model or provider policy. Adapt any other request parameters and payload as needed.</Check>
                <Check>Return a valid payload matching the supplied JSON schema.</Check>
                <Check>Raw number, ISO date, canonical text, boolean or null.</Check>
                <Check>Use null only when evidence is insufficient; otherwise cite a source.</Check>
                <Check>Report the complete run cost as estimatedCostUsd.</Check>
              </div>
            </div>

            <div className="border border-white/10 bg-[#0b1820]/90 p-5 backdrop-blur-sm">
              <SectionKicker>INPUT, FORMAT & EXAMPLE</SectionKicker>
              <ContractFile path="data/playbook/questions.json" detail="Input questions sent to your code" />
              <ContractFile path="data/playbook/candidate-output-schema.json" detail="Required candidate answer format—this is authoritative" />
              <ContractFile path="data/playbook/expected-output.json" detail="Worked example and practice answer key" />
              <ContractFile path="lib/challenge/types.ts" detail="Input and output types" />
              <ContractFile path="lib/challenge/openrouter.ts" detail="GLM 5.3 Flash model and provider price policy" />
              <ContractFile path="app/api/answer/route.ts" detail="HTTP entrypoint called by the test" />
              <ContractFile path=".env.example" detail="OpenRouter environment variables" />
            </div>
          </aside>
        </section>

        <section className="overflow-hidden border border-white/10 bg-[#0b1820]/90 backdrop-blur-sm">
          <div className="flex flex-col justify-between gap-5 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div><SectionKicker>MINIMAL RUNNER</SectionKicker><h2 className="mt-2 text-xl font-semibold">Run your implementation</h2><p className="mt-1 text-xs text-[#7e8f95]">The UI measures wall-clock time, compares both JSON files and scores every question.</p></div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" role="switch" aria-checked={demoMode} onClick={() => { setDemoMode((enabled) => !enabled); setRunState("idle"); setResult(null); }} disabled={runState === "running"} className="flex h-11 items-center justify-between gap-3 border border-white/10 bg-[#071117] px-3 text-left disabled:opacity-50">
                <span><b className="block font-mono text-[9px] tracking-[.12em] text-[#cbd4d4]">DEMO RUN</b><span className="mt-1 block text-[9px] text-[#64767d]">Preview the evaluator</span></span>
                <span className={`relative h-5 w-9 border transition-colors ${demoMode ? "border-[#62d2a4]/50 bg-[#62d2a4]/20" : "border-white/20 bg-white/5"}`}><i className={`absolute top-0.5 size-3.5 transition-transform ${demoMode ? "translate-x-[17px] bg-[#62d2a4]" : "translate-x-0.5 bg-[#66777d]"}`} /></span>
              </button>
              <Button className="h-11 rounded-none bg-[#ee5b4b] px-6 font-mono text-[10px] font-bold tracking-[.12em] text-white shadow-[0_0_24px_rgba(238,91,75,.15)] hover:bg-[#d94c3e]" onClick={startRun} disabled={runState === "running"}>{runState === "running" ? "ANALYSIS RUNNING…" : demoMode ? "RUN DEMO  →" : runState === "complete" ? "RUN AGAIN" : "START ANALYSIS  →"}</Button>
            </div>
          </div>

          {runState === "idle" && <div className="grid min-h-44 place-items-center px-6 py-10 text-center"><div><span className="mx-auto grid size-11 place-items-center border border-[#d99a50]/40 bg-[#d99a50]/10 text-[#d99a50]">▶</span><p className="mt-4 text-sm font-medium">{demoMode ? "Demo output ready" : "Awaiting candidate implementation"}</p><p className="mt-1 text-xs text-[#718188]">{demoMode ? "Run the demo to preview JSON comparison and scoring." : "Run the practice evaluation when your answer function is ready."}</p></div></div>}

          {runState === "running" && <div className="min-h-44 px-6 py-12" aria-live="polite"><div className="mx-auto max-w-xl"><div className="mb-3 flex justify-between font-mono text-[10px] tracking-wider text-[#95a4a9]"><span>RUNNING CANDIDATE PIPELINE</span><span>LIVE</span></div><div className="h-1 overflow-hidden bg-white/10"><div className="h-full w-2/3 animate-pulse bg-[#ee5b4b]" /></div><p className="mt-4 text-center font-mono text-[9px] text-[#62747b]">PARSING · RETRIEVAL · MODEL CALLS · JSON ASSEMBLY</p></div></div>}

          {runState === "complete" && result && <div aria-live="polite">
            <div className="grid grid-cols-2 border-b border-white/10 md:grid-cols-4"><RunMetric label="CORRECT" value={`${correctCount}/50`} note="value + source" accent /><RunMetric label="ACCURACY" value={`${Math.round((correctCount / comparison.length) * 100)}%`} note="practice score" /><RunMetric label="LOCAL EXEC DURATION" value={`${(result.durationMs / 1000).toFixed(2)}s`} note="browser start to finish" /><RunMetric label="EST. COST" value={`$${result.output.estimatedCostUsd.toFixed(4)}`} note="candidate reported" /></div>

            <div className="grid border-b border-white/10 lg:grid-cols-2">
              <JsonPanel label="GENERATED OUTPUT" value={result.output} />
              <JsonPanel label="EXPECTED OUTPUT" value={expectedOutput} />
            </div>

            <div className="flex items-end justify-between gap-4 border-b border-white/10 px-5 py-5">
              <div><SectionKicker>COMPARISON MATRIX</SectionKicker><h3 className="mt-2 text-lg font-semibold">Question-by-question result</h3></div>
              <p className="hidden max-w-md text-right text-[10px] leading-4 text-[#718188] sm:block">Green means the canonical value matches and at least one submitted source overlaps the accepted source set.</p>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="border-b border-white/10 font-mono text-[9px] tracking-[.12em] text-[#65777e]"><tr><th className="px-5 py-3 font-medium">QUESTION</th><th className="px-5 py-3 font-medium">GENERATED</th><th className="px-5 py-3 font-medium">EXPECTED</th><th className="px-5 py-3 font-medium">SUBMITTED SOURCE</th><th className="px-5 py-3 font-medium">EXPECTED SOURCE</th><th className="px-5 py-3 text-right font-medium">RESULT</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.questionId} className={`border-b last:border-b-0 ${row.correct ? "border-[#62d2a4]/15 bg-[#62d2a4]/[.045]" : "border-[#ee5b4b]/15 bg-[#ee5b4b]/[.045]"}`}><td className="px-5 py-3 font-mono text-[#8ec4c9]">{row.questionId}</td><td className={`px-5 py-3 font-mono ${row.valueMatches ? "text-[#8ddbb9]" : "text-[#ff8d80]"}`}>{displayValue(row.submitted?.value)}</td><td className="px-5 py-3 font-mono text-[#dce2df]">{displayValue(row.expected.value)}</td><td className={`max-w-52 px-5 py-3 font-mono text-[10px] ${row.sourceMatches ? "text-[#8ddbb9]" : "text-[#ff8d80]"}`}>{row.submitted?.evidenceFileIds.join(" + ") || "missing"}</td><td className="max-w-52 px-5 py-3 font-mono text-[10px] text-[#7f9096]">{row.expected.evidenceFileIds.join(" + ")}</td><td className="px-5 py-3 text-right"><span className={`inline-flex min-w-20 justify-center border px-2 py-1 font-mono text-[9px] font-bold tracking-[.12em] ${row.correct ? "border-[#62d2a4]/30 bg-[#62d2a4]/10 text-[#8ddbb9]" : "border-[#ee5b4b]/30 bg-[#ee5b4b]/10 text-[#ff8d80]"}`}>{row.correct ? "✓ CORRECT" : "× REVIEW"}</span></td></tr>)}</tbody></table></div>
          </div>}

          {runState === "error" && <div className="min-h-44 px-6 py-10" aria-live="polite"><div className="border-l-2 border-[#ee5b4b] bg-[#071117] p-5"><p className="font-mono text-[10px] tracking-[.12em] text-[#ee5b4b]">RUN FAILED</p><p className="mt-3 text-sm text-[#c4cdce]">{error}</p><p className="mt-2 text-xs text-[#718188]">Implement the candidate pipeline, then run it again.</p></div></div>}
        </section>

        <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-white/10 pt-6 font-mono text-[9px] tracking-[.1em] text-[#5e7077] sm:flex-row"><span>AI-ASSISTED CODING IS STRONGLY RECOMMENDED</span><span>WORKING PROTOTYPE · EXPLAIN YOUR CHOICES</span></footer>
      </div>
    </main>
  );
}

function HeaderMetric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) { return <div className="min-w-32 border-b border-r border-white/10 p-4 last:border-r-0 sm:border-b-0 lg:border-b lg:[&:nth-child(2n)]:border-r-0 lg:[&:nth-last-child(-n+2)]:border-b-0"><b className={`block font-mono text-xl ${accent ? "text-[#d99a50]" : "text-[#eef1ed]"}`}>{value}</b><span className="mt-1 block font-mono text-[8px] tracking-[.13em] text-[#6c7e85]">{label}</span></div>; }
function Step({ index, title, detail, complete = false }: { index: string; title: string; detail: string; complete?: boolean }) { return <div className="flex items-center gap-4 border-r border-white/10 px-1 py-5 last:border-r-0 sm:px-5"><span className={`grid size-8 shrink-0 place-items-center border font-mono text-[10px] ${complete ? "border-[#67c8a1]/30 bg-[#67c8a1]/10 text-[#7bd7b1]" : "border-[#d99a50]/35 bg-[#d99a50]/10 text-[#d99a50]"}`}>{complete ? "✓" : index}</span><div><p className="text-xs font-semibold">{title}</p><p className="mt-1 font-mono text-[9px] text-[#64767d]">{detail}</p></div></div>; }
function SectionKicker({ children }: { children: React.ReactNode }) { return <p className="font-mono text-[9px] font-bold tracking-[.16em] text-[#ee5b4b]">{children}</p>; }
function Check({ children }: { children: React.ReactNode }) { return <div className="flex gap-2.5 text-xs leading-5 text-[#9eaaae]"><span className="text-[#72d3ac]">✓</span><span>{children}</span></div>; }
function ContractFile({ path, detail }: { path: string; detail: string }) { return <div className="mt-3 border-b border-white/[.07] pb-3 last:border-b-0 last:pb-0"><code className="block break-all font-mono text-[10px] text-[#9bc9cc]">{path}</code><p className="mt-1 text-[10px] text-[#697a81]">{detail}</p></div>; }
function RunMetric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) { return <div className="border-r border-white/10 p-5 last:border-r-0"><p className="font-mono text-[9px] tracking-[.12em] text-[#687980]">{label}</p><p className={`mt-2 text-3xl font-semibold tracking-tight ${accent ? "text-[#d99a50]" : "text-white"}`}>{value}</p><p className="mt-1 text-[10px] text-[#718188]">{note}</p></div>; }
function JsonPanel({ label, value }: { label: string; value: unknown }) { return <div className="min-w-0 border-b border-white/10 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><div className="border-b border-white/10 px-5 py-3 font-mono text-[9px] font-bold tracking-[.14em] text-[#d99a50]">{label}</div><pre className="max-h-[420px] overflow-auto p-5 font-mono text-[10px] leading-5 text-[#aebfc2]"><code>{JSON.stringify(value, null, 2)}</code></pre></div>; }
