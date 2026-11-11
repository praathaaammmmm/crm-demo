import type { Task } from "@crm/contracts/tasks";
import { EmptyState } from "../../components/EmptyState";
import { groupForMyTasks } from "../../lib/task-view";
import { TaskTable } from "./TaskTable";
import styles from "./Tasks.module.css";

/** The assignee's focused view: work that needs action first, then work waiting on review or done. */
export function MyTasksList({ tasks, projectNameOf }: { tasks: Task[]; projectNameOf: (id: string) => string }) {
  if (tasks.length === 0) return <EmptyState title="No tasks assigned to you" />;
  const { needsAction, waiting } = groupForMyTasks(tasks);
  const nameOf = () => "You";
  return (
    <>
      {[
        { title: "Needs action", items: needsAction },
        { title: "Waiting or done", items: waiting },
      ].map((group) =>
        group.items.length === 0 ? null : (
          <section key={group.title} className={styles.group} aria-label={group.title}>
            <h2 className={styles.groupTitle}>
              {group.title} <span className={styles.count}>{String(group.items.length)}</span>
            </h2>
            <TaskTable tasks={group.items} nameOf={nameOf} projectNameOf={projectNameOf} showAssignee={false} caption={group.title} />
          </section>
        ),
      )}
    </>
  );
}
