/**
 * Provenance verification for memory writes (D4, F05). The operator (who ran
 * the tool) and the source (who stated the fact) are separate, and a model
 * passing `source: "user"` is not evidence by itself.
 *
 * The only rule the Runtime can apply reliably is strict equality: the stored
 * statement must equal the whole current user input after collapsing runs of
 * whitespace. Case, negation, quotation and paths are all significant, so no
 * substring, case-insensitive or token-overlap matching is attempted — those
 * would confirm "Use npm" from "Do not use npm" or `/srv/foo` from `/srv/Foo`.
 * Anything else (a rewrite, a translation, an excerpt) stays agent_inferred;
 * the chief can record Tian's exact words, or Tian can confirm explicitly.
 */

export interface InputEvidence {
  entryId: string;
  /** `user` for a real user submission; anything else cannot confirm. */
  kind: 'user' | 'system.notification' | 'worker.input';
  text: string;
}

export interface EvidenceVerdict {
  confirmed: boolean;
  reason: string;
}

/** Whitespace-only normalization; case and punctuation are preserved. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Confirm a claim against the current input. A system wake or worker input
 * never confirms, and a real user turn confirms only a statement equal to the
 * whole turn. Everything else stays agent_inferred and says why.
 */
export function verifyUserEvidence(
  claim: string,
  input: InputEvidence | null,
): EvidenceVerdict {
  if (!input || input.kind !== 'user')
    return {
      confirmed: false,
      reason:
        'the current request was not started by Tian (system wake or worker input), so it is agent_inferred',
    };
  const normalizedClaim = normalize(claim);
  const normalizedTurn = normalize(input.text);
  if (!normalizedClaim || !normalizedTurn)
    return {
      confirmed: false,
      reason: 'the current user input is empty, so it is agent_inferred',
    };
  if (normalizedClaim === normalizedTurn)
    return {
      confirmed: true,
      reason: 'Tian stated exactly this in the current user turn',
    };
  return {
    confirmed: false,
    reason:
      "the current user turn is not this exact statement, so it is agent_inferred — record Tian's exact words (or ask Tian to confirm) to have it confirmed",
  };
}
