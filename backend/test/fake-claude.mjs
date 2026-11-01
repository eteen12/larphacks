// Fake `claude` CLI for runAgent tests. Scenario picked by FIXTURE_SCENARIO.
// Emits stream-json lines on stdout like claude -p --output-format stream-json --verbose.
const scenario = process.env.FIXTURE_SCENARIO ?? "ok";

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

if (scenario === "hang") {
  setInterval(() => {}, 1000);
} else if (scenario === "noanswer") {
  emit({ type: "system", subtype: "init", session_id: "s1", tools: [] });
  process.exit(0);
} else if (scenario === "echo") {
  // Returns the -p prompt as the final answer so tests can inspect what the agent was told.
  const prompt = process.argv[process.argv.indexOf("-p") + 1];
  emit({ type: "system", subtype: "init", session_id: "s1", tools: [] });
  emit({ type: "result", subtype: "success", result: prompt, is_error: false, num_turns: 1 });
  process.exit(0);
} else {
  emit({ type: "system", subtype: "init", session_id: "s1", tools: [] });
  emit({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Grep", input: { pattern: "discount|margin" } },
        { type: "tool_use", name: "Read", input: { file_path: "vault/notes/2026-10-28.md" } },
        { type: "tool_use", name: "Read", input: { file_path: "github/issue.md" } },
      ],
    },
  });
  emit({
    type: "result",
    subtype: "success",
    result:
      scenario === "error" ? "Failed to authenticate" : '{"decisions":[],"code":[],"findings":[]}',
    is_error: scenario === "error",
    num_turns: 3,
  });
  process.exit(0);
}
