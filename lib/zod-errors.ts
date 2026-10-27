/**
 * zod 4 removed `required_error` and `invalid_type_error`. This keeps their
 * meaning as one `error` map: `required` when the value is missing,
 * `invalidType` when it has another type, and zod's default message when the
 * matching one is omitted. Messages on checks (`.min(1, "...")`) still win.
 */
export function typeErrors(messages: { required?: string; invalidType?: string }) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? messages.required : messages.invalidType;
}
