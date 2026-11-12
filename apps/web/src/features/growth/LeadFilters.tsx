import { GROWTH_STAGES, stageLabel, type GrowthStage } from "@crm/contracts/growth-leads";
import { FilterBar, FilterDivider } from "../../components/FilterBar";
import { PillLink } from "../../components/Pill";
import { hrefWith } from "../../lib/search-params";

export interface LeadFilterState {
  view: "board" | "list";
  stage: GrowthStage | undefined;
  overdue: boolean;
  stale: boolean;
  archived: boolean;
}

export const leadsHref = (state: LeadFilterState, change: Partial<LeadFilterState> = {}): string => {
  const next = { ...state, ...change };
  return hrefWith("/growth/leads", {
    view: next.view === "list" ? "list" : undefined,
    stage: next.stage,
    overdue: next.overdue ? "true" : undefined,
    stale: next.stale ? "true" : undefined,
    archived: next.archived ? "true" : undefined,
  });
};

/** Link-based filters, so a filtered view can be shared. The board shows every stage, so stage filters are list-only. */
export function LeadFilters({ state }: { state: LeadFilterState }) {
  const active = state.stage !== undefined || state.overdue || state.stale || state.archived;
  return (
    <FilterBar clearHref={active ? leadsHref({ view: state.view, stage: undefined, overdue: false, stale: false, archived: false }) : null}>
      <PillLink href={leadsHref(state, { overdue: !state.overdue })} selected={state.overdue}>
        Overdue
      </PillLink>
      <PillLink href={leadsHref(state, { stale: !state.stale })} selected={state.stale}>
        Stale
      </PillLink>
      <PillLink href={leadsHref(state, { archived: !state.archived })} selected={state.archived}>
        Archived
      </PillLink>
      {state.view === "list" ? (
        <>
          <FilterDivider />
          {GROWTH_STAGES.map((stage) => (
            <PillLink key={stage} href={leadsHref(state, { stage: state.stage === stage ? undefined : stage })} selected={state.stage === stage}>
              {stageLabel(stage)}
            </PillLink>
          ))}
        </>
      ) : null}
    </FilterBar>
  );
}
