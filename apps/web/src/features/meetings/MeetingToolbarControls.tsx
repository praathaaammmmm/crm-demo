import Link from "next/link";
import { FilterBar, FilterDivider } from "../../components/FilterBar";
import { Icon } from "../../components/Icon";
import { PillLink } from "../../components/Pill";
import styles from "../../components/Toolbar.module.css";
import { addDays } from "../../lib/meeting-view";
import { hrefWith } from "../../lib/search-params";

export interface MeetingFilterState {
  view: "agenda" | "week";
  /** Monday of the shown week (week view). */
  week: string;
  /** Agenda shows upcoming scheduled meetings or cancelled ones. */
  status: "scheduled" | "cancelled";
}

/** Only API-backed controls: view, week navigation and status. No search or sort. */
export function MeetingToolbarControls({ state, thisWeek }: { state: MeetingFilterState; thisWeek: string }) {
  const href = (overrides: Partial<Record<"view" | "week" | "status", string | undefined>>) =>
    hrefWith("/meetings", {
      view: state.view === "agenda" ? undefined : state.view,
      week: state.view === "week" && state.week !== thisWeek ? state.week : undefined,
      status: state.status === "scheduled" ? undefined : state.status,
      ...overrides,
    });

  return (
    <FilterBar clearHref={null}>
      <nav aria-label="View" className={styles.switch}>
        {(["agenda", "week"] as const).map((view) => (
          <Link
            key={view}
            href={href({ view: view === "agenda" ? undefined : view, week: undefined })}
            className={styles.switchItem}
            aria-current={view === state.view ? "page" : undefined}
          >
            <Icon name={view === "agenda" ? "list" : "calendar"} />
            {view === "agenda" ? "Agenda" : "Week"}
          </Link>
        ))}
      </nav>
      <FilterDivider />
      {state.view === "week" ? (
        <>
          <PillLink href={href({ week: addDays(state.week, -7) })} selected={false}>
            Previous week
          </PillLink>
          <PillLink href={href({ week: undefined })} selected={state.week === thisWeek}>
            This week
          </PillLink>
          <PillLink href={href({ week: addDays(state.week, 7) })} selected={false}>
            Next week
          </PillLink>
        </>
      ) : (
        <>
          <PillLink href={href({ status: undefined })} selected={state.status === "scheduled"}>
            Upcoming
          </PillLink>
          <PillLink href={href({ status: "cancelled" })} selected={state.status === "cancelled"}>
            Cancelled
          </PillLink>
        </>
      )}
    </FilterBar>
  );
}
