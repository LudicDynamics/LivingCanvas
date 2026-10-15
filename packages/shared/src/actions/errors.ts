import type { ActionDetails } from './types.js';

export type ActionErrorCode =
  | 'invalid_argument' // malformed / out-of-range parameters
  | 'invalid_path' // path not world-relative, escaping the root, reserved prefix
  | 'invalid_asset_ref' // media reference is outside the published asset roots or has the wrong type
  | 'not_found' // target file / directory / entity does not exist
  | 'already_exists' // target exists and this action may not overwrite
  | 'not_movable' // violates 00 §2.4 (README / directory / outside the world)
  | 'not_interactive' // target has no choice / roll_dice block
  | 'choice_not_found' // index or text matches no option
  | 'malformed_entity' // file exists but its declared structure is broken
  | 'invalid_field_value' // a declared field's value is unusable (1d100x / unparsable expect)
  | 'dice_already_rolled' // doc-20 §7: a die with a result refuses a re-roll
  | 'dice_forced_not_allowed' // forcedResult is god-only (doc-21 §4.3)
  | 'near_out_of_layer' // `near` is not in the destination layer (doc-20 §4)
  | 'no_free_seat' // seating failed
  | 'conflict' // optimistic canvas/version or snapshot fence failed
  | 'unsupported' // legal but not implemented in this phase
  | 'write_failed' // disk write failed (incl. atomic write failure)
  | 'event_failed' // append failed after the file write already succeeded
  | 'command_log_corrupt' // doc-command/05 §7: a hand-edited command_log entry is malformed
  | 'command_log_full' // doc-command/05 §7: the 32-entry idempotency log is full; refusing beats truncating
  | 'command_resume_drifted' // doc-command/05 §7: on.<hook>[index] no longer names the running command
  | 'game_ended' // the design notes: a closed world reached its ending; only conversation remains
  | 'player_owned' // the design notes: a player note belongs to the player alone
  | 'internal';

/** HTTP status per code — the single落点 for the C entry (01 §7.1). */
export const HTTP_STATUS: Record<ActionErrorCode, number> = {
  invalid_argument: 400,
  invalid_path: 400,
  invalid_asset_ref: 400,
  not_found: 404,
  already_exists: 409,
  conflict: 409,
  not_movable: 409,
  not_interactive: 422,
  choice_not_found: 422,
  malformed_entity: 422,
  invalid_field_value: 422,
  dice_already_rolled: 409,
  dice_forced_not_allowed: 403,
  near_out_of_layer: 422,
  no_free_seat: 507,
  unsupported: 501,
  write_failed: 500,
  event_failed: 500,
  command_log_corrupt: 422,
  command_log_full: 409,
  command_resume_drifted: 409,
  game_ended: 409,
  player_owned: 403,
  internal: 500,
};

/**
 * The ONLY failure channel of the action layer.
 * Convention (00 §8 / doc-21 §3.6): throwing means nothing was appended;
 * a caught ActionError MUST NEVER be downgraded into a success result.
 */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly httpStatus: number;
  readonly details: ActionDetails;

  constructor(args: { code: ActionErrorCode; message: string; details?: ActionDetails }) {
    super(args.message);
    this.name = 'ActionError';
    this.code = args.code;
    this.httpStatus = HTTP_STATUS[args.code];
    this.details = args.details ?? {};
  }

  /** Wrapper for the A entry (00 §6.2 frozen ToolResult shape). */
  toToolResult(): {
    content: [{ type: 'text'; text: string }];
    isError: true;
    details: ActionDetails;
  } {
    return {
      content: [{ type: 'text', text: this.message }],
      isError: true,
      details: { ...this.details, code: this.code, httpStatus: this.httpStatus },
    };
  }

  /** Wrapper for the C entry. */
  toHttp(): { status: number; body: { ok: false; code: ActionErrorCode; error: string } } {
    return {
      status: this.httpStatus,
      body: { ok: false, code: this.code, error: this.message },
    };
  }
}

/** One-line call site for the hot paths. */
export function fail(code: ActionErrorCode, message: string, details?: ActionDetails): never {
  throw new ActionError({ code, message, details });
}
