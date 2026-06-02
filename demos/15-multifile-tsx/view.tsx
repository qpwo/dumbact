/** TSX views for the multi-file bike shop service queue server/client demo. */
import { statusText } from "./data.ts";
import { addJob, advance, draft, jobs, setDraft, status, summary } from "./state.ts";

type Job = { id: string; title: string; owner: string; status: string; minutes: number };

function JobRow(props) {
  const job: Job = props.job;
  return <li class={"it " + (job.status === "done" ? "done" : "")} key={job.id} data-job-id={job.id}>
    <span>
      <strong>{job.title}</strong>
      <br />
      <span class="mut">{job.owner} / {job.minutes} min / </span><span class="tag">{statusText[job.status] || job.status}</span>
    </span>
    <button data-testid={"queue-advance-" + job.id} onClick={() => advance(job.id)}>Advance</button>
  </li>;
}

function QueueForm() {
  return <form class="rw" onSubmit={addJob}>
    <input data-testid="queue-input" value={draft()} onInput={event => setDraft(event.target.value)} placeholder="New service job" aria-label="new service job" />
    <button data-testid="queue-add">Add job</button>
  </form>;
}

export function QueueApp() {
  const rows = jobs();
  const s = summary();
  return <section class="gd" data-ready="15-queue-tsx">
    <article class="c stk">
      <div class="sp">
        <div>
          <h2>Queue</h2>
          <p class="mut">Jobs move through todo, doing, and done through real server endpoints.</p>
        </div>
        <div class="big" data-testid="queue-open">{s.open}</div>
      </div>
      <QueueForm />
    </article>
    <aside class="c stk">
      <h2>Today</h2>
      <p>{'Open work: ' + s.open}</p>
      <p data-testid="queue-done">{s.done}</p>
      <p>{'Open minutes: ' + s.minutes}</p>
      <p class="mut" data-testid="queue-status">{status()}</p>
    </aside>
    <article class="c wide stk">
      <h2>Repair cards</h2>
      <ul class="ls" data-testid="queue-list">{rows.map(job => <JobRow job={job} key={job.id} />)}</ul>
    </article>
  </section>;
}
