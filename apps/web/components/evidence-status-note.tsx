import type { Locale } from '@ara/shared';
import type { CandidateEvidenceView } from '../lib/candidate-evidence';
import { evidencePresentation } from '../lib/evidence-copy';

export function EvidenceStatusNote({ view, locale }: {
  readonly view: CandidateEvidenceView;
  readonly locale: Locale;
}) {
  const text = evidencePresentation(view, locale);
  return (
    <span className="research-object__preverified" data-evidence-status={text.state}>
      <strong>{text.label}</strong>
      <span>{text.collected}</span>
    </span>
  );
}
