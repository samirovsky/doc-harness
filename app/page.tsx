import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { evidenceFiles } from "@/lib/challenge/source-files";

const contractFiles = [
  {
    path: "data/playbook/questions.json",
    label: "INPUT",
    title: "Questions to answer",
    text: "The runner sends this JSON playbook to your solution. The real assessment replaces it with another question set.",
  },
  {
    path: "data/playbook/candidate-output-schema.json",
    label: "FORMAT TO RESPECT",
    title: "Required output contract",
    text: "This is authoritative. Your returned JSON must follow this exact structure: case ID, estimated cost, and answers keyed by question ID with values and source-file IDs.",
    important: true,
  },
  {
    path: "data/playbook/expected-output.json",
    label: "WORKED EXAMPLE",
    title: "Practice answer key",
    text: "This is a complete example for the training set. Use it to understand and test the expected result; candidate-output-schema.json is the format authority.",
  },
];

export default function CandidateBrief() {
  return (
    <main className="min-h-screen bg-[#0b141b] text-[#f5f1e8]">
      <header className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-[#0b141b]/60 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <span className="grid size-8 rotate-45 place-items-center border border-[#d99a50] font-mono text-xs font-bold text-[#d99a50]"><i className="-rotate-45 not-italic">A</i></span>
            <span className="text-xs font-bold tracking-[.2em]">ANDOR CASE LAB</span>
          </div>
          <Badge variant="outline" className="border-white/15 bg-black/20 font-mono text-[10px] tracking-wider text-[#aeb9bd]">CANDIDATE BRIEF</Badge>
        </div>
      </header>

      <section className="relative min-h-[680px] overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/hero-andor.jpg')" }} />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,16,22,.98)_0%,rgba(8,16,22,.88)_42%,rgba(8,16,22,.34)_78%,rgba(8,16,22,.55)_100%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(142,196,201,.14)_1px,transparent_1px),linear-gradient(90deg,rgba(142,196,201,.14)_1px,transparent_1px)] [background-size:42px_42px] [mask-image:linear-gradient(90deg,#000,transparent_75%)]" />
        <div className="relative z-10 mx-auto flex min-h-[680px] max-w-6xl items-center px-5 pb-14 pt-28">
          <div className="max-w-3xl">
            <p className="mb-6 font-mono text-[11px] font-bold tracking-[.18em] text-[#ee5b4b]">RECRUITING CASE · PRACTICE ENVIRONMENT</p>
            <h1 className="text-6xl font-black leading-[.88] tracking-[-.065em] sm:text-8xl lg:text-[112px]">THE <span className="text-[#ee5b4b]">SIGNAL</span><br />TEST</h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-[#c1c9cb] sm:text-xl">Build something that answers 50 questions from a mixed-format data room—accurately, quickly, and at low model cost.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-none bg-[#ee5b4b] px-6 font-mono text-xs font-bold tracking-wider text-white hover:bg-[#d94c3e]"><Link href="/workspace">Open workspace <span className="ml-5">→</span></Link></Button>
              <Button asChild size="lg" variant="outline" className="rounded-none border-white/20 bg-black/20 px-6 font-mono text-xs tracking-wider text-white hover:bg-white/10 hover:text-white"><a href="#task">Read the brief</a></Button>
            </div>
            <div className="mt-12 grid max-w-2xl grid-cols-2 border border-white/15 bg-[#0b141b]/75 backdrop-blur-sm sm:grid-cols-4">
              <HeroStat value="30" label="FILES" />
              <HeroStat value="50" label="QUESTIONS" />
              <HeroStat value="3–4h" label="TIME BOX" />
              <HeroStat value="$20" label="PRACTICE CREDIT" />
            </div>
          </div>
        </div>
      </section>

      <section id="task" className="mx-auto max-w-6xl px-5 py-20">
        <SectionLabel>01 / THE TASK</SectionLabel>
        <h2 className="max-w-3xl text-4xl font-semibold tracking-[-.04em] sm:text-6xl">Three steps. One measurable result.</h2>
        <div className="mt-10 grid border border-white/10 md:grid-cols-3">
          <SimpleStep number="01" title="Read the files">Parse the PDF, Word, Excel, CSV, PowerPoint, and image evidence using any tools or libraries you want.</SimpleStep>
          <SimpleStep number="02" title="Answer the questions">Retrieve, reconcile, calculate, and canonicalize the best answer for every question.</SimpleStep>
          <SimpleStep number="03" title="Return strict JSON">Include each answer, its supporting source file, and your estimated OpenRouter cost.</SimpleStep>
        </div>
        <div className="mt-6 border-l-2 border-[#d99a50] bg-[#101c25] p-6 text-base leading-7 text-[#bdc6c8]">
          We are not asking for production-ready software. We want something that works end to end, reflects good thinking, and that you can explain clearly in a live discussion. AI-assisted coding is encouraged.
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#101c25]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionLabel>02 / HOW YOUR CODE IS CALLED</SectionLabel>
          <h2 className="text-4xl font-semibold tracking-[-.04em] sm:text-5xl">The test has one entrypoint.</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[#9eaaae]">Write as many functions, agents, scripts, or modules as you need. Connect them through <code>answerCase()</code>. The runner sends an HTTP request to <code>route.ts</code>, which calls your function.</p>
          <div className="mt-9 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowBox kicker="TEST ENTRYPOINT" path="app/api/answer/route.ts">Receives the question playbook from the runner.</FlowBox>
            <FlowArrow />
            <FlowBox kicker="YOUR COORDINATOR" path="lib/candidate/answer.ts">Calls the functions that make up your solution.</FlowBox>
            <FlowArrow />
            <FlowBox kicker="YOUR IMPLEMENTATION" path="any files you create">Parsing, retrieval, agents, model calls, reconciliation, and formatting.</FlowBox>
          </div>
          <p className="mt-5 font-mono text-[10px] tracking-[.08em] text-[#718188]">THE EVALUATOR CALLS ROUTE.TS → ROUTE.TS RECORDS THE RUN AND CALLS ANSWERCASE() → ANSWERCASE() CALLS YOUR PIPELINE</p>
          <div className="mt-8 border border-[#ee5b4b]/40 bg-[#ee5b4b]/[.06] p-6">
            <p className="font-mono text-[9px] font-bold tracking-[.14em] text-[#ff8d80]">FRESH-CLONE RULE · IMPORTANT</p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-[#c8d0d1]">For the private evaluation, we will replace the practice files, manifest, questions, and answer key with a new unseen case using the same input and output contracts.</p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-[#c8d0d1]">Do not overfit to practice filenames, values, indexes, or cached artifacts. Your submitted repository must work end to end from the raw files after <code>npm install</code> and <code>npm run dev</code>, with any required parsing or preprocessing triggered automatically.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionLabel>03 / WHAT IS PROVIDED</SectionLabel>
        <div className="grid gap-px overflow-hidden border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-3">
          <Provided title="Raw data room">30 original files. Parsing and OCR are your responsibility.</Provided>
          <Provided title="Questions + practice solution">A complete training playbook and answer key for iteration.</Provided>
          <Provided title="Locked model access">Use GLM 5.3 Flash and the supplied provider pool unchanged: $0.20/M input and $0.60/M output caps. Optimize every other request field.</Provided>
          <Provided title="Minimal runner">Starts the request, measures local exec duration, and compares both answer JSONs.</Provided>
          <Provided title="SQLite included">Runs are logged automatically. Use the same D1/SQLite connector for mid-execution state if useful.</Provided>
          <Provided title="Freedom of approach">Use any harness, library, framework, coding agent, or orchestration strategy.</Provided>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#101c25]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionLabel>04 / INPUT, FORMAT & EXAMPLE</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-.04em] sm:text-5xl">Know which file does what.</h2>
          <div className="mt-9 grid gap-4 lg:grid-cols-3">
            {contractFiles.map((file) => (
              <article key={file.path} className={`border p-6 ${file.important ? "border-[#ee5b4b]/50 bg-[#ee5b4b]/[.06]" : "border-white/10 bg-[#0b161d]"}`}>
                <span className={`font-mono text-[9px] font-bold tracking-[.14em] ${file.important ? "text-[#ff8d80]" : "text-[#8ec4c9]"}`}>{file.label}</span>
                <code className="mt-4 block break-all font-mono text-xs text-[#dce2df]">{file.path}</code>
                <h3 className="mt-5 font-semibold">{file.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#8f9ca1]">{file.text}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 grid overflow-hidden border border-white/10 lg:grid-cols-[.75fr_1.25fr]">
            <div className="bg-[#0b161d] p-6"><p className="font-mono text-[9px] font-bold tracking-[.14em] text-[#d99a50]">OUTPUT RULES</p><div className="mt-5 space-y-3"><Rule>Answers are keyed by question ID; order does not matter.</Rule><Rule>Use raw numbers, ISO dates, canonical text, booleans, or <code>null</code>.</Rule><Rule>Every non-null answer needs at least one supporting file ID.</Rule><Rule>Include the total estimated model cost as <code>estimatedCostUsd</code>.</Rule><Rule>Keep the supplied GLM 5.3 Flash model and provider policy unchanged; all other request parameters and payload content are yours.</Rule></div></div>
            <pre className="overflow-x-auto border-t border-white/10 bg-[#071117] p-6 font-mono text-xs leading-6 text-[#b9ced0] lg:border-l lg:border-t-0"><code>{`{
  "caseId": "practice-case",
  "estimatedCostUsd": 0.8421,
  "answers": {
    "q_001": {
      "value": "kestrel meridian cooperative",
      "evidenceFileIds": ["04_governance_charter.pdf"]
    }
  }
}`}</code></pre>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <SectionLabel>05 / THE DATA ROOM</SectionLabel>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-4xl font-semibold tracking-[-.04em] sm:text-5xl">30 files, ready to open.</h2><p className="mt-3 text-sm text-[#8f9ca1]">Click any file below to inspect or download it.</p></div><Badge variant="outline" className="w-fit border-[#d99a50]/40 text-[#d99a50]">RAW SOURCE FILES</Badge></div>
        <div className="mt-8 grid overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {evidenceFiles.map((file, index) => (
            <a key={file.name} href={`/case-files/${file.name}`} target="_blank" rel="noreferrer" download={["CSV", "DOCX", "PPTX", "XLSX"].includes(file.type) ? file.name : undefined} className="group flex min-w-0 items-center gap-3 border-b border-r border-white/10 bg-[#0b161d] px-4 py-3 transition-colors hover:bg-[#12242d] focus-visible:bg-[#12242d] focus-visible:outline-none">
              <span className="grid size-8 shrink-0 place-items-center border border-[#d99a50]/30 bg-[#d99a50]/10 font-mono text-[8px] font-bold text-[#d99a50]">{file.type.slice(0, 2)}</span>
              <div className="min-w-0 flex-1"><code className="block break-all font-mono text-[10px] leading-4 text-[#b9ced0] group-hover:text-white">{file.name}</code><span className="mt-1 block font-mono text-[8px] tracking-wider text-[#63757c]">FILE {String(index + 1).padStart(2, "0")}</span></div>
              <span aria-hidden="true" className="font-mono text-[9px] text-[#65777e] group-hover:text-[#d99a50]">↗</span>
            </a>
          ))}
        </div>

        <div className="mt-8 grid overflow-hidden border border-[#d99a50]/25 bg-[#101c25] lg:grid-cols-[1fr_420px]">
          <div className="p-7">
            <p className="font-mono text-[9px] font-bold tracking-[.14em] text-[#d99a50]">NO EXCEL OR OFFICE SUITE?</p>
            <h3 className="mt-3 text-2xl font-semibold">You can inspect the files for free.</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#a9b4b6]">
              <p><strong className="text-[#edf0ed]">With AI:</strong> Claude or Codex can inspect spreadsheet files directly as part of your workflow.</p>
              <p><strong className="text-[#edf0ed]">In a browser:</strong> Upload <code>.xls</code> or <code>.xlsx</code> files to Google Drive, then open them with Google Sheets. Word and PowerPoint files can similarly open in Google Docs and Slides.</p>
            </div>
            <a href="https://support.google.com/docs/answer/9331167?hl=en" target="_blank" rel="noreferrer" className="mt-6 inline-flex border border-white/15 px-4 py-2 font-mono text-[10px] tracking-[.08em] text-[#9bd5d8] transition-colors hover:border-[#8ec4c9] hover:text-white">GOOGLE’S STEP-BY-STEP GUIDE ↗</a>
          </div>
          <div className="border-t border-white/10 bg-[#071117] lg:border-l lg:border-t-0">
            <div className="border-b border-white/10 px-4 py-3 font-mono text-[9px] tracking-[.12em] text-[#718188]">VIDEO · EXCEL TO GOOGLE SHEETS · 2 MIN</div>
            <iframe className="aspect-video w-full" src="https://www.youtube-nocookie.com/embed/YqE7H9O_GXs" title="How to convert an Excel file to Google Sheets" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#101c25]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionLabel>06 / WHAT MATTERS</SectionLabel>
          <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr]">
            <div><h2 className="text-4xl font-semibold tracking-[-.04em] sm:text-6xl">Think clearly.<br />Explain why.</h2><p className="mt-5 text-base leading-7 text-[#9eaaae]">The result matters, but so does your understanding. In the live discussion, be ready to walk through how you decomposed the problem, reconciled conflicting evidence, controlled context and cost, and chose your trade-offs.</p></div>
            <div className="grid grid-cols-2 border border-white/10"><Metric value="01" label="Accuracy" text="Correct canonical value and supporting source." /><Metric value="02" label="Format" text="JSON matches candidate-output-schema.json exactly." /><Metric value="03" label="Local Exec Duration" text="Measured from request start to response." /><Metric value="04" label="Estimated cost" text="Reported from your OpenRouter usage." /></div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b141b]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionLabel>07 / WHAT WE EXPECT IN YOUR README</SectionLabel>
          <h2 className="max-w-3xl text-4xl font-semibold tracking-[-.04em] sm:text-5xl">Tell us what you built—and what comes next.</h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[#9eaaae]">Submit the complete working repository, including your harness and supporting code. Before you send it, add a short, practical section to the README covering these three points.</p>
          <div className="mt-10 grid border border-white/10 md:grid-cols-3">
            <SimpleStep number="01" title="Architecture & technical choices">Explain how your pipeline works and why you chose its main components, libraries, agents, storage, and retrieval approach.</SimpleStep>
            <SimpleStep number="02" title="Precision, cost & speed">Explain the trade-offs you made and how your design aims to produce accurate answers quickly and economically.</SimpleStep>
            <SimpleStep number="03" title="What you would improve">Tell us what you would change with more time, how you would implement it, and why it would improve the result.</SimpleStep>
          </div>
          <div className="mt-12 flex flex-col items-start justify-between gap-5 border-l-2 border-[#ee5b4b] bg-[#0b161d] p-7 sm:flex-row sm:items-center"><div><p className="font-semibold">Ready to begin?</p><p className="mt-1 text-sm text-[#8f9ca1]">Use the demo run first to see the comparison matrix.</p></div><Button asChild className="rounded-none bg-[#ee5b4b] font-mono text-xs tracking-wider text-white hover:bg-[#d94c3e]"><Link href="/workspace">Open workspace →</Link></Button></div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#081117]"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 px-5 py-8 font-mono text-[10px] tracking-wider text-[#65757b] sm:flex-row"><span>ANDOR CASE LAB · AI-ASSISTED BUILD ENCOURAGED</span><span>PRACTICE MODE · $20 CREDIT</span></div></footer>
    </main>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) { return <div className="border-b border-r border-white/15 p-4 even:border-r-0 sm:border-b-0 sm:even:border-r sm:last:border-r-0"><strong className="block font-mono text-xl text-[#d99a50]">{value}</strong><span className="mt-1 block font-mono text-[9px] tracking-widest text-[#859398]">{label}</span></div>; }
function SectionLabel({ children }: { children: React.ReactNode }) { return <p className="mb-6 font-mono text-[10px] font-bold tracking-[.16em] text-[#ee5b4b]">{children}</p>; }
function SimpleStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) { return <div className="border-b border-white/10 bg-[#0b161d] p-7 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><span className="font-mono text-[10px] text-[#ee5b4b]">{number}</span><h3 className="mt-8 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-[#8f9ca1]">{children}</p></div>; }
function Provided({ title, children }: { title: string; children: React.ReactNode }) { return <div className="min-h-40 bg-[#101c25] p-6"><span className="text-[#72d3ac]">✓</span><h3 className="mt-6 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#8f9ca1]">{children}</p></div>; }
function FlowBox({ kicker, path, children }: { kicker: string; path: string; children: React.ReactNode }) { return <div className="border border-white/10 bg-[#0b161d] p-5"><span className="font-mono text-[8px] font-bold tracking-[.14em] text-[#d99a50]">{kicker}</span><code className="mt-3 block break-all font-mono text-xs text-[#9bd5d8]">{path}</code><p className="mt-3 text-xs leading-5 text-[#8f9ca1]">{children}</p></div>; }
function FlowArrow() { return <div className="grid place-items-center py-1 font-mono text-[#ee5b4b] lg:px-1 lg:py-0"><span className="rotate-90 lg:rotate-0">→</span></div>; }
function Rule({ children }: { children: React.ReactNode }) { return <div className="flex gap-3 text-sm text-[#bdc6c8]"><span className="text-[#d99a50]">✓</span><span>{children}</span></div>; }
function Metric({ value, label, text }: { value: string; label: string; text: string }) { return <div className="min-h-40 border-b border-r border-white/10 p-6 odd:border-r"><span className="font-mono text-[10px] text-[#ee5b4b]">{value}</span><h3 className="mt-6 font-semibold">{label}</h3><p className="mt-2 text-xs leading-5 text-[#829097]">{text}</p></div>; }
