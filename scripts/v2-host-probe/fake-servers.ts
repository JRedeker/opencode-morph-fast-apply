// Loopback-only fake servers for the v2 host probe. Started by
// sandbox-inner.sh inside the bwrap network namespace; run.sh judges the
// recorded requests after the sandbox exits.
//
// One process, two listeners, both on 127.0.0.1:
//
//   :8787  fake OpenAI provider speaking the Responses API (`/v1/responses`),
//          which is what the 2.3.2 built-in `openai` provider uses when its
//          baseURL is overlaid through config. Records every request body and
//          scripts a fixed conversation:
//          turn 1 -> morph_edit function call (success case)
//          turn 2 -> morph_edit function call (outside-root case)
//          turn 3 -> final text
//          Requests without a morph_edit-capable tools array (title
//          generation etc.) get a plain text answer.
//
//   :8788  fake Morph Apply endpoint (chat-completions shaped, matching the
//          plugin's callMorphApply). Records every request body and returns a
//          fixed merged file as choices[0].message.content.
//
// Usage: bun fake-servers.ts <records-dir>

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const providerPort = 8787;
const morphPort = 8788;
const recordsDir = process.argv[2] ?? "/home/probe/records";
mkdirSync(recordsDir, { recursive: true });

const MERGED_FILE =
  'const greeting = "hello world";\n\nfunction ping() {\n  return greeting;\n}\n';

const SUCCESS_EDIT_ARGS = {
  target_filepath: "target.ts",
  instructions: "I am changing the greeting to say hello world.",
  code_edit:
    '// ... existing code ...\nconst greeting = "hello world";\n// ... existing code ...\n',
};

const OUTSIDE_EDIT_ARGS = {
  target_filepath: "../outside.txt",
  instructions: "I am trying to edit a file outside the session root.",
  code_edit: "// ... existing code ...\ntampered\n// ... existing code ...\n",
};

let providerSeq = 0;
let morphSeq = 0;

function record(file: string, entry: Record<string, unknown>) {
  appendFileSync(path.join(recordsDir, file), `${JSON.stringify(entry)}\n`);
}

interface ResponsesTool {
  name?: string;
}

interface ResponsesInputItem {
  type?: string;
  name?: string;
}

interface ResponsesRequest {
  stream?: boolean;
  tools?: ResponsesTool[];
  input?: ResponsesInputItem[] | string;
}

function morphEditCallsSeen(body: ResponsesRequest): number {
  const input = Array.isArray(body.input) ? body.input : [];
  return input.filter(
    (item) => item.type === "function_call" && item.name === "morph_edit",
  ).length;
}

// A conversation request carries a tools list that exposes morph_edit either
// as a direct tool or inside the Code Mode `execute` catalog.
function isConversationRequest(body: ResponsesRequest): boolean {
  return (body.tools ?? []).some(
    (tool) => tool.name === "morph_edit" || tool.name === "execute",
  );
}

function nextProviderTurn(body: ResponsesRequest) {
  if (!isConversationRequest(body)) {
    return { kind: "text" as const, text: "probe title" };
  }
  const seen = morphEditCallsSeen(body);
  if (seen === 0) {
    return {
      kind: "call" as const,
      callId: "call_probe_1",
      args: SUCCESS_EDIT_ARGS,
    };
  }
  if (seen === 1) {
    return {
      kind: "call" as const,
      callId: "call_probe_2",
      args: OUTSIDE_EDIT_ARGS,
    };
  }
  return { kind: "text" as const, text: "probe complete" };
}

function usage() {
  return {
    input_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2,
  };
}

function sse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

type ProviderTurn = ReturnType<typeof nextProviderTurn>;

function sendResponsesStream(res: ServerResponse, turn: ProviderTurn) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const responseId = "resp_probe";
  sse(res, "response.created", {
    type: "response.created",
    response: { id: responseId, status: "in_progress", model: "probe-model" },
  });
  if (turn.kind === "call") {
    const argumentsJson = JSON.stringify(turn.args);
    const item = {
      type: "function_call",
      id: `fc_${turn.callId}`,
      call_id: turn.callId,
      name: "morph_edit",
      arguments: "",
      status: "in_progress",
    };
    sse(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item,
    });
    sse(res, "response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: item.id,
      output_index: 0,
      delta: argumentsJson,
    });
    sse(res, "response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: item.id,
      output_index: 0,
      arguments: argumentsJson,
    });
    const done = { ...item, arguments: argumentsJson, status: "completed" };
    sse(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: done,
    });
    sse(res, "response.completed", {
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed",
        model: "probe-model",
        output: [done],
        usage: usage(),
      },
    });
  } else {
    const item = {
      type: "message",
      id: "msg_probe",
      role: "assistant",
      status: "in_progress",
      content: [],
    };
    sse(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item,
    });
    sse(res, "response.output_text.delta", {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: turn.text,
    });
    sse(res, "response.output_text.done", {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: turn.text,
    });
    const done = {
      ...item,
      status: "completed",
      content: [{ type: "output_text", text: turn.text, annotations: [] }],
    };
    sse(res, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: done,
    });
    sse(res, "response.completed", {
      type: "response.completed",
      response: {
        id: responseId,
        status: "completed",
        model: "probe-model",
        output: [done],
        usage: usage(),
      },
    });
  }
  res.end();
}

function sendResponsesJson(res: ServerResponse, turn: ProviderTurn) {
  const output =
    turn.kind === "call"
      ? [
          {
            type: "function_call",
            id: `fc_${turn.callId}`,
            call_id: turn.callId,
            name: "morph_edit",
            arguments: JSON.stringify(turn.args),
            status: "completed",
          },
        ]
      : [
          {
            type: "message",
            id: "msg_probe",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: turn.text, annotations: [] },
            ],
          },
        ];
  const body = JSON.stringify({
    id: "resp_probe",
    object: "response",
    created_at: 0,
    status: "completed",
    model: "probe-model",
    output,
    usage: usage(),
  });
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const data of req) chunks.push(data as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const provider = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  let body: ResponsesRequest = {};
  try {
    body = JSON.parse(await readBody(req)) as ResponsesRequest;
  } catch {
    // keep {} so a malformed request still gets a usable reply
  }
  record("provider.jsonl", {
    seq: ++providerSeq,
    method: req.method,
    path: req.url,
    body,
  });
  const turn = nextProviderTurn(body);
  if (body.stream === true) sendResponsesStream(res, turn);
  else sendResponsesJson(res, turn);
});

const morph = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  const raw = await readBody(req);
  record("morph.jsonl", {
    seq: ++morphSeq,
    method: req.method,
    path: req.url,
    body: raw,
  });
  const body = JSON.stringify({
    choices: [
      {
        message: { role: "assistant", content: MERGED_FILE },
        finish_reason: "stop",
      },
    ],
  });
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
});

provider.listen(providerPort, "127.0.0.1", () => {
  writeFileSync(path.join(recordsDir, "provider.ready"), "1");
});
morph.listen(morphPort, "127.0.0.1", () => {
  writeFileSync(path.join(recordsDir, "morph.ready"), "1");
});
