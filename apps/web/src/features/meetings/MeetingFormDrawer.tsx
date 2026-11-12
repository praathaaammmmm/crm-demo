"use client";

import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES, meetingResponseBodySchema, type Meeting } from "@crm/contracts/meetings";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "../../components/Button";
import { DialogFooter } from "../../components/Dialog";
import { Drawer } from "../../components/Drawer";
import { ErrorNotice } from "../../components/ErrorNotice";
import { FormField } from "../../components/FormField";
import { apiRequest } from "../../lib/api-client";
import { isSafeProofUrl } from "../../lib/task-actions";
import { useAction } from "../../lib/use-action";
import styles from "./Meetings.module.css";

export interface PersonOption {
  id: string;
  name: string;
}
export interface TaskOption {
  id: string;
  title: string;
  projectId: string;
}

/** Values the form starts from, in the organisation's time zone. */
export interface MeetingFormInitial {
  meeting: Meeting;
  startsAtLocal: string;
  durationMinutes: number;
  attendeeIds: string[];
}

/**
 * CEO only: schedule a meeting, or edit one (sending only what changed). The organiser attends
 * automatically and is not listed. Times are wall-clock in the organisation's time zone.
 */
export function MeetingFormDrawer({
  people,
  projects,
  tasks,
  initial,
  defaultStart,
}: {
  people: PersonOption[];
  projects: PersonOption[];
  tasks: TaskOption[];
  initial?: MeetingFormInitial;
  defaultStart: string;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(initial?.meeting.projectId ?? "");
  const { busy, error, setError, run, router } = useAction();
  const uid = useId();
  const editing = initial !== undefined;

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const text = (key: string) => {
      const value = data.get(key);
      return typeof value === "string" ? value.trim() : "";
    };
    const attendeeIds = data.getAll("attendeeIds").filter((value): value is string => typeof value === "string");
    const duration = Number(text("durationMinutes"));
    const link = text("meetingUrl");
    if (text("title").length === 0 || text("startsAtLocal").length === 0) {
      setError("Add a title and a start time.");
      return;
    }
    if (!Number.isInteger(duration) || duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
      setError(`The duration must be ${String(MIN_DURATION_MINUTES)}–${String(MAX_DURATION_MINUTES)} minutes.`);
      return;
    }
    if (attendeeIds.length === 0) {
      setError("Choose at least one attendee.");
      return;
    }
    if (link.length > 0 && !isSafeProofUrl(link)) {
      setError("Use a meeting link that starts with https://");
      return;
    }
    const fields = {
      title: text("title"),
      description: text("description"),
      startsAtLocal: text("startsAtLocal"),
      durationMinutes: duration,
      location: text("location"),
      meetingUrl: link,
      projectId: text("projectId"),
      taskId: text("taskId"),
    };

    if (!editing) {
      const body = {
        title: fields.title,
        description: fields.description,
        startsAtLocal: fields.startsAtLocal,
        durationMinutes: fields.durationMinutes,
        attendeeIds,
        ...(fields.location ? { location: fields.location } : {}),
        ...(fields.meetingUrl ? { meetingUrl: fields.meetingUrl } : {}),
        ...(fields.projectId ? { projectId: fields.projectId } : {}),
        ...(fields.taskId ? { taskId: fields.taskId } : {}),
      };
      const ok = await run(
        () => apiRequest("/meetings", meetingResponseBodySchema, { method: "POST", body }),
        (created) => {
          router.push(`/meetings/${created.meeting.id}`);
        },
      );
      if (ok) close();
      return;
    }

    const { meeting } = initial;
    const changes: Record<string, unknown> = {};
    if (fields.title !== meeting.title) changes["title"] = fields.title;
    if (fields.description !== meeting.description) changes["description"] = fields.description;
    if (fields.startsAtLocal !== initial.startsAtLocal) changes["startsAtLocal"] = fields.startsAtLocal;
    if (fields.durationMinutes !== initial.durationMinutes) changes["durationMinutes"] = fields.durationMinutes;
    if (fields.location !== (meeting.location ?? "")) changes["location"] = fields.location || null;
    if (fields.meetingUrl !== (meeting.meetingUrl ?? "")) changes["meetingUrl"] = fields.meetingUrl || null;
    if (fields.projectId !== (meeting.projectId ?? "")) changes["projectId"] = fields.projectId || null;
    if (fields.taskId !== (meeting.taskId ?? "")) changes["taskId"] = fields.taskId || null;
    const sameAttendees =
      attendeeIds.length === initial.attendeeIds.length && attendeeIds.every((id) => initial.attendeeIds.includes(id));
    if (!sameAttendees) changes["attendeeIds"] = attendeeIds;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    if (await run(() => apiRequest(`/meetings/${meeting.id}`, meetingResponseBodySchema, { method: "PATCH", body: changes }))) close();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(event.currentTarget);
  }

  const taskChoices = tasks.filter((task) => task.projectId === projectId);
  const title = editing ? "Edit meeting" : "New meeting";
  return (
    <>
      <Button
        size="sm"
        variant={editing ? "secondary" : "primary"}
        onClick={() => {
          setOpen(true);
        }}
      >
        {title}
      </Button>
      <Drawer open={open} onClose={close} title={title}>
        <form onSubmit={onSubmit} noValidate>
          {error ? (
            <div className={styles.formError}>
              <ErrorNotice message={error} />
            </div>
          ) : null}
          <FormField id={`${uid}-title`} label="Title">
            <input id={`${uid}-title`} name="title" required maxLength={200} defaultValue={initial?.meeting.title ?? ""} />
          </FormField>
          <FormField id={`${uid}-description`} label="Description">
            <textarea id={`${uid}-description`} name="description" maxLength={5000} defaultValue={initial?.meeting.description ?? ""} />
          </FormField>
          <div className={styles.formRow}>
            <FormField id={`${uid}-start`} label="Starts" hint="In the organisation's time zone.">
              <input
                id={`${uid}-start`}
                name="startsAtLocal"
                type="datetime-local"
                required
                defaultValue={initial?.startsAtLocal ?? defaultStart}
              />
            </FormField>
            <FormField id={`${uid}-duration`} label="Duration (minutes)">
              <input
                id={`${uid}-duration`}
                name="durationMinutes"
                type="number"
                min={MIN_DURATION_MINUTES}
                max={MAX_DURATION_MINUTES}
                step={5}
                required
                defaultValue={initial?.durationMinutes ?? 30}
              />
            </FormField>
          </div>
          <div className={styles.formRow}>
            <FormField id={`${uid}-location`} label="Location">
              <input id={`${uid}-location`} name="location" maxLength={500} defaultValue={initial?.meeting.location ?? ""} />
            </FormField>
            <FormField id={`${uid}-link`} label="Meeting link" hint="Optional. Must start with https://">
              <input
                id={`${uid}-link`}
                name="meetingUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                maxLength={2000}
                defaultValue={initial?.meeting.meetingUrl ?? ""}
              />
            </FormField>
          </div>
          <div className={styles.formRow}>
            <FormField id={`${uid}-project`} label="Project (optional)">
              <select
                id={`${uid}-project`}
                name="projectId"
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                }}
              >
                <option value="">None</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id={`${uid}-task`} label="Task (optional)">
              <select
                id={`${uid}-task`}
                name="taskId"
                key={projectId}
                disabled={projectId === ""}
                defaultValue={initial?.meeting.projectId === projectId ? (initial.meeting.taskId ?? "") : ""}
              >
                <option value="">None</option>
                {taskChoices.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <fieldset className={styles.checklist}>
            <legend className="visually-hidden">Attendees</legend>
            {people.map((person) => (
              <label key={person.id} className={styles.check}>
                <input type="checkbox" name="attendeeIds" value={person.id} defaultChecked={initial?.attendeeIds.includes(person.id) ?? false} />
                {person.name}
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              {editing ? "Save changes" : "Schedule meeting"}
            </Button>
          </DialogFooter>
        </form>
      </Drawer>
    </>
  );
}
