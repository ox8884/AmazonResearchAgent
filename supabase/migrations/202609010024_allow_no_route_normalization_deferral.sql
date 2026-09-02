create or replace function public.defer_candidate_normalization(
  job_id uuid,
  job_lease_owner text,
  job_lease_epoch integer,
  analysis_id uuid,
  candidate_id uuid,
  expected_candidate_state text,
  expected_normalization_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  job_row public.jobs%rowtype;
  analysis_row public.ai_analyses%rowtype;
  candidate_row public.candidates%rowtype;
  reasons jsonb;
  decision_key text;
begin
  job_row := public.assert_current_job_lease(job_id, job_lease_owner, job_lease_epoch);
  perform public.assert_normalization_job_payload(
    job_row.payload, candidate_id, expected_normalization_generation
  );
  select * into analysis_row from public.ai_analyses a
  where a.id = analysis_id for update;
  select * into candidate_row from public.candidates c
  where c.id = candidate_id for update;
  if analysis_row.id is null
     or analysis_row.role <> 'niche_normalization'
     or analysis_row.input_payload->>'candidateId' is distinct from candidate_id::text
     or coalesce((analysis_row.input_payload->>'normalizationGeneration')::bigint, 0)
        is distinct from expected_normalization_generation then
    raise exception 'candidate_defer_rejected';
  end if;
  if candidate_row.state = 'Waiting for AI Capacity' then
    return jsonb_build_object('kind', 'already_deferred', 'target_state', candidate_row.state);
  end if;
  if candidate_row.id is null
     or candidate_row.state <> expected_candidate_state
     or candidate_row.normalization_generation <> expected_normalization_generation
     or exists (
       select 1 from public.normalized_candidate_finalizations f
       where f.candidate_id = defer_candidate_normalization.candidate_id
         and f.normalization_generation = expected_normalization_generation
     )
     or exists (
       select 1 from public.provider_attempt_events e
       where e.logical_analysis_id = analysis_id and e.event_type = 'attempt_succeeded'
     )
     or exists (
       select 1 from public.provider_attempt_events s
       where s.logical_analysis_id = analysis_id and s.event_type = 'attempt_started'
         and not exists (
           select 1 from public.provider_attempt_events o
           where o.attempt_id = s.attempt_id and o.event_type <> 'attempt_started'
         )
     ) then
    raise exception 'candidate_defer_rejected';
  end if;
  reasons := public.append_candidate_reason(
    candidate_row.rule_reasons,
    'AI_PROVIDER_UNAVAILABLE',
    'The configured AI provider is unavailable; retry when capacity returns.'
  );
  decision_key := format(
    'ai-normalization-deferred:%s:%s', candidate_id, expected_normalization_generation
  );
  insert into public.decision_history (
    candidate_id, from_state, to_state, reasons, decided_by, idempotency_key
  ) values (
    candidate_id, candidate_row.state, 'Waiting for AI Capacity', reasons,
    'provider-exhaustion', decision_key
  ) on conflict (idempotency_key) do nothing;
  update public.candidates c
  set state = 'Waiting for AI Capacity', niche_cluster_id = null, rule_reasons = reasons
  where c.id = candidate_id
    and c.state = expected_candidate_state
    and c.normalization_generation = expected_normalization_generation;
  if not found then
    raise exception 'candidate_defer_cas_conflict';
  end if;
  return jsonb_build_object(
    'kind', 'deferred', 'target_state', 'Waiting for AI Capacity'
  );
end;
$$;
