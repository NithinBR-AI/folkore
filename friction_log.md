# Folkore — Friction Log
Amazon Alexa+ Hackathon 2026

---

## Friction 1 — KB Ingestion Concurrency

**Task attempted:** Add a memory and immediately retrieve it via Bedrock Knowledge Base.

**Steps taken:** Called `add_memory` → wrote to S3 → fired `StartIngestionJob` → called `retrieve` within 2 seconds.

**Expected:** Second ingestion call queues or merges with the running job.

**Actual:** `ConflictException` — only one ingestion job can run at a time. Second call fails silently with no retry or queue mechanism.

**Severity:** High — rapid memory adds during demo caused retrieval misses that were hard to diagnose.

**Workaround:** Built a sync guard — `ListIngestionJobs` before every `StartIngestionJob`. If a job is running, skip the fire; the file is already in S3 and will be picked up. Added DynamoDB keyword retrieval as the always-fresh layer so KB sync state never blocks immediate retrieval.

**Actionable suggestion:** Expose a `queueIngestionJob` API that automatically coalesces concurrent requests into the next available job slot, or returns a job ID for a pending job the caller can poll.

---

## Friction 2 — No Scheduled MCP Tool Invocation

**Task attempted:** Trigger `morning_memory` automatically each morning per registered parent via EventBridge.

**Steps taken:** Attempted to configure an EventBridge rule targeting the MCP server endpoint directly. No native target type exists for MCP tool invocation. Explored Lambda bridge — adds cold start latency and an extra service to manage.

**Expected:** EventBridge → MCP tool call, same as a user utterance but with `initiatedBy: "system"` in the payload.

**Actual:** No path from EventBridge to an MCP tool without an intermediary Lambda. Proactive experiences require external orchestration outside the MCP runtime.

**Severity:** High — proactive voice experiences (morning memory, reminders, digest triggers) are core to companion use cases. Having no native scheduled invocation forces every MCP developer to maintain a Lambda bridge.

**Workaround:** Manual trigger via UI button in the demo. Documented as "Stage 3" in the submission.

**Actionable suggestion:** Add a scheduled invocation target type for Alexa+ MCP tools in EventBridge — similar to how Lambda and Step Functions are first-class targets. Payload schema should mirror the MCP tool input.

---

## Friction 3 — Mantle Gateway Error Messages

**Task attempted:** Debug a failed LLM inference call through the Bedrock Mantle gateway during agent loop development.

**Steps taken:** Called `POST /v1/chat/completions` with a malformed tool definition. Received HTTP 400 with a generic error body — no field-level detail about which part of the tool schema was invalid.

**Expected:** Error message pointing to the specific tool definition field that failed validation (e.g. `tools[1].function.parameters.properties` missing `type`).

**Actual:** Flat `{"error": "Bad Request"}` with no schema path, no field name, no hint about which of the 6 tool definitions was malformed.

**Severity:** Medium — added ~2 hours of debugging time bisecting tool definitions one by one to isolate the bad field.

**Workaround:** Binary search — commented out tool definitions in halves until the bad one was isolated.

**Actionable suggestion:** Return structured validation errors from the Mantle gateway matching the OpenAI error format: `{"error": {"message": "...", "param": "tools[1].function.parameters", "code": "invalid_schema"}}`. This is the format developers already expect from the OpenAI-compatible endpoint contract.
