import type { TodoLogEntry, TodoSummary } from "@/types/domain";

// The To Do page's calls to its own API, in one place so every control surfaces the route's own
// sentence on failure (rule 7) rather than a generic one of its own.
//
// Pure fetch — no server imports — so the client components can use it.

export const TODOS_QUERY_KEY = "todos";
export const TODO_DETAIL_QUERY_KEY = "todo";

export type TodoStatusFilter = "open" | "done";

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export async function sendTodoRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await readBody(response);

  if (!response.ok) {
    throw new Error(
      typeof parsed.error === "string" ? parsed.error : "Something went wrong. Please try again.",
    );
  }

  return parsed;
}

export async function fetchTodos(status: TodoStatusFilter): Promise<TodoSummary[]> {
  const response = await fetch(`/api/todos?status=${status}`);
  const parsed = await readBody(response);

  if (!response.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "Could not load your to-dos.");
  }

  return parsed.todos as TodoSummary[];
}

export async function fetchTodoLog(todoId: string): Promise<TodoLogEntry[]> {
  const response = await fetch(`/api/todos/${todoId}`);
  const parsed = await readBody(response);

  if (!response.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "Could not load the timeline.");
  }

  return parsed.log as TodoLogEntry[];
}
